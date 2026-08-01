import type { RunPhase } from "@/lib/contracts";
import { RunAbortedError, RunControlFence } from "@/orchestration/control";
import { errorMessage, RoundExecutionError } from "@/orchestration/errors";
import { settleWithConcurrency } from "@/orchestration/parallel";
import { createModelProvider, ProviderError } from "@/orchestration/providers";
import type { ModelProvider, ModelResponse } from "@/orchestration/providers";
import {
  buildDraftPrompt,
  buildReviewPrompt,
  buildSynthesisPrompt,
  type RoundPromptContext
} from "@/orchestration/prompts";
import { buildReviewAssignments } from "@/orchestration/topology";
import type {
  ArtifactFailure,
  ArtifactIdentity,
  ClaimedRunJob,
  ExecutionAgent,
  OrchestrationRepository,
  PreparedIteration,
  RunSnapshot,
  StoredArtifact
} from "@/orchestration/types";

export interface RoundProcessorOptions {
  draftConcurrency?: number;
  reviewConcurrency?: number;
  controlPollIntervalMs?: number;
  providerRequestTimeoutMs?: number;
  providerRetryLimit?: number;
  providerRetryBaseDelayMs?: number;
  jobRetryBaseDelayMs?: number;
  providerFactory?: (agent: ExecutionAgent) => ModelProvider;
}

export type ProcessJobResult =
  | "completed"
  | "obsolete"
  | "cancelled"
  | "retry_scheduled"
  | "failed";

const DEFAULT_OPTIONS = {
  draftConcurrency: 4,
  reviewConcurrency: 6,
  controlPollIntervalMs: 500,
  providerRequestTimeoutMs: 120_000,
  providerRetryLimit: 2,
  providerRetryBaseDelayMs: 500,
  jobRetryBaseDelayMs: 2_000
};

export class RoundProcessor {
  readonly #repository: OrchestrationRepository;
  readonly #options: Required<Omit<RoundProcessorOptions, "providerFactory">>;
  readonly #providerFactory: (agent: ExecutionAgent) => ModelProvider;

  constructor(repository: OrchestrationRepository, options: RoundProcessorOptions = {}) {
    this.#repository = repository;
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    this.#providerFactory =
      options.providerFactory ??
      ((agent) =>
        createModelProvider(agent.connection, {
          timeoutMs: agent.parameters.timeoutMs ?? this.#options.providerRequestTimeoutMs
        }));
  }

  async process(job: ClaimedRunJob, shutdownSignal?: AbortSignal): Promise<ProcessJobResult> {
    let iteration: PreparedIteration | null = null;
    let fence: RunControlFence | null = null;

    try {
      const snapshot = await this.#repository.loadRunSnapshot(job);

      if (!snapshot || snapshot.controlVersion !== job.controlVersion) {
        await this.#repository.completeObsoleteJob(job, "stale_or_missing_run");
        return "obsolete";
      }

      if (snapshot.desiredState !== "running") {
        await this.#repository.completeObsoleteJob(job, `run_is_${snapshot.desiredState}`);
        return "obsolete";
      }

      if (hasReachedIterationLimit(snapshot)) {
        await this.#repository.completeObsoleteJob(job, "iteration_limit_reached");
        return "completed";
      }

      if (hasReachedTokenLimit(snapshot)) {
        await this.#repository.completeObsoleteJob(job, "token_limit_reached");
        return "completed";
      }

      fence = new RunControlFence(
        this.#repository,
        job,
        {
          controlVersion: snapshot.controlVersion,
          desiredState: snapshot.desiredState,
          stopMode: snapshot.stopMode
        },
        this.#options.controlPollIntervalMs
      );
      fence.start();
      const shutdownListener = () => fence?.abortForShutdown();
      shutdownSignal?.addEventListener("abort", shutdownListener, { once: true });

      try {
        iteration = await this.#repository.prepareIteration(
          job,
          fence.controlVersion,
          snapshot.currentIteration + 1
        );

        if (!iteration) {
          await fence.refresh();
          throw new RoundExecutionError("Could not prepare a fenced iteration", true);
        }

        job.iterationId = iteration.id;

        const promptContext: RoundPromptContext = {
          objective: snapshot.objective,
          pendingInstruction: snapshot.pendingInstruction,
          previousSynthesis: snapshot.previousSynthesis,
          iterationNumber: iteration.number
        };

        await this.setPhase(job, fence, iteration, "drafting");
        const drafts = await this.generateDrafts(job, fence, iteration, snapshot, promptContext);

        if (drafts.length === 0) {
          throw new RoundExecutionError("No agent produced a usable draft", true);
        }

        await this.setPhase(job, fence, iteration, "reviewing");
        const reviews = await this.generateReviews(
          job,
          fence,
          iteration,
          snapshot,
          promptContext,
          drafts
        );

        await this.setPhase(job, fence, iteration, "synthesizing");
        const synthesis = await this.generateSynthesis(
          job,
          fence,
          iteration,
          snapshot,
          promptContext,
          drafts,
          reviews
        );

        await this.setPhase(job, fence, iteration, "checkpointing");
        await fence.refresh();
        const roundArtifacts = [...drafts, ...reviews, synthesis];
        const inputTokens = roundArtifacts.reduce((total, artifact) => total + artifact.inputTokens, 0);
        const outputTokens = roundArtifacts.reduce((total, artifact) => total + artifact.outputTokens, 0);
        const stopReason = determineStopReason(
          snapshot,
          fence,
          iteration.number,
          inputTokens + outputTokens,
          reviews
        );
        const checkpoint = await this.#repository.checkpointRound({
          job,
          controlVersion: fence.controlVersion,
          iteration,
          synthesis,
          inputTokens,
          outputTokens,
          continueRunning: stopReason === null,
          stopReason
        });

        if (!checkpoint.accepted) {
          await fence.refresh();
          throw new RoundExecutionError("Checkpoint was rejected by the execution fence", true);
        }

        return "completed";
      } finally {
        shutdownSignal?.removeEventListener("abort", shutdownListener);
      }
    } catch (error) {
      if (error instanceof RunAbortedError) {
        if (error.reason === "worker_shutdown") {
          await this.#repository.retryJob(job, error.message, 0);
          return "retry_scheduled";
        }

        await this.#repository.cancelIteration(
          job,
          fence?.controlVersion ?? job.controlVersion,
          iteration,
          error.reason
        );
        return "cancelled";
      }

      const retryable =
        error instanceof RoundExecutionError
          ? error.retryable
          : error instanceof ProviderError
            ? error.retryable
            : true;
      const message = errorMessage(error);

      if (retryable && job.attempts < job.maxAttempts) {
        const delayMs = boundedBackoff(
          this.#options.jobRetryBaseDelayMs,
          Math.max(0, job.attempts - 1),
          60_000
        );
        await this.#repository.retryJob(job, message, delayMs);
        return "retry_scheduled";
      }

      await this.#repository.failJob(job, message);
      return "failed";
    } finally {
      fence?.stop();
    }
  }

  private async generateDrafts(
    job: ClaimedRunJob,
    fence: RunControlFence,
    iteration: PreparedIteration,
    snapshot: RunSnapshot,
    promptContext: RoundPromptContext
  ): Promise<StoredArtifact[]> {
    const draftAgents = snapshot.agents.filter((agent) => agent.roles.includes("draft"));
    const settled = await settleWithConcurrency(
      draftAgents,
      this.#options.draftConcurrency,
      async (agent) => {
        const prompt = buildDraftPrompt(agent, promptContext);
        return this.generateArtifact(job, fence, iteration, agent, {
          kind: "draft",
          agentId: agent.id,
          targetAgentId: null
        }, prompt);
      },
      fence.signal
    );

    fence.throwIfAborted();
    return fulfilledArtifacts(settled);
  }

  private async generateReviews(
    job: ClaimedRunJob,
    fence: RunControlFence,
    iteration: PreparedIteration,
    snapshot: RunSnapshot,
    promptContext: RoundPromptContext,
    drafts: StoredArtifact[]
  ): Promise<StoredArtifact[]> {
    const assignments = buildReviewAssignments(
      snapshot.agents,
      drafts,
      snapshot.reviewTopology,
      iteration.number
    );
    const settled = await settleWithConcurrency(
      assignments,
      this.#options.reviewConcurrency,
      async ({ reviewer, draft }) => {
        const prompt = buildReviewPrompt(reviewer, promptContext, draft);
        return this.generateArtifact(
          job,
          fence,
          iteration,
          reviewer,
          { kind: "review", agentId: reviewer.id, targetAgentId: draft.agentId },
          prompt,
          draft.id
        );
      },
      fence.signal
    );

    fence.throwIfAborted();
    return fulfilledArtifacts(settled);
  }

  private async generateSynthesis(
    job: ClaimedRunJob,
    fence: RunControlFence,
    iteration: PreparedIteration,
    snapshot: RunSnapshot,
    promptContext: RoundPromptContext,
    drafts: StoredArtifact[],
    reviews: StoredArtifact[]
  ): Promise<StoredArtifact> {
    const synthesizer = snapshot.agents.find((agent) => agent.id === snapshot.synthesizerAgentId);

    if (!synthesizer || !synthesizer.roles.includes("synthesize")) {
      throw new RoundExecutionError("Configured synthesizer is not eligible", false);
    }

    const prompt = buildSynthesisPrompt(synthesizer, promptContext, drafts, reviews);
    return this.generateArtifact(
      job,
      fence,
      iteration,
      synthesizer,
      { kind: "synthesis", agentId: synthesizer.id, targetAgentId: null },
      prompt
    );
  }

  private async generateArtifact(
    job: ClaimedRunJob,
    fence: RunControlFence,
    iteration: PreparedIteration,
    agent: ExecutionAgent,
    identity: ArtifactIdentity,
    prompt: { instructions: string; input: string },
    draftArtifactId?: string
  ): Promise<StoredArtifact> {
    await fence.refresh();
    let reservation = await this.#repository.reserveArtifact(
      job,
      fence.controlVersion,
      iteration,
      identity
    );

    if (!reservation) {
      await fence.refresh();
      reservation = await this.#repository.reserveArtifact(
        job,
        fence.controlVersion,
        iteration,
        identity
      );
    }

    if (!reservation) {
      throw new RoundExecutionError("Artifact reservation was rejected by the execution fence", true);
    }

    if (reservation.state === "complete") {
      return reservation.artifact;
    }

    if (reservation.state === "busy") {
      throw new RoundExecutionError("Artifact is owned by another active worker", true);
    }

    try {
      const response = await this.callProviderWithRetries(
        agent,
        prompt,
        fence,
        [job.runId, agent.id, identity.kind, identity.targetAgentId ?? "primary"].join(":")
      );
      let completed = await this.#repository.completeArtifact(
        job,
        fence.controlVersion,
        iteration,
        reservation.artifact.id,
        response,
        draftArtifactId
      );

      if (!completed) {
        await fence.refresh();
        completed = await this.#repository.completeArtifact(
          job,
          fence.controlVersion,
          iteration,
          reservation.artifact.id,
          response,
          draftArtifactId
        );
      }

      if (!completed) {
        throw new RoundExecutionError("Late provider result was rejected by the execution fence", true);
      }

      return completed;
    } catch (error) {
      fence.throwIfAborted();
      const providerError = error instanceof ProviderError ? error : null;
      const failure: ArtifactFailure = {
        message: errorMessage(error),
        code: providerError?.code ?? "orchestration",
        retryable: providerError?.retryable ?? true
      };
      await this.#repository.failArtifact(
        job,
        fence.controlVersion,
        iteration,
        reservation.artifact.id,
        failure,
        false
      );
      throw error;
    }
  }

  private async callProviderWithRetries(
    agent: ExecutionAgent,
    prompt: { instructions: string; input: string },
    fence: RunControlFence,
    sessionKey: string
  ): Promise<ModelResponse> {
    let attempt = 0;

    while (true) {
      await fence.refresh();

      try {
        return await this.#providerFactory(agent).generate({
          model: agent.model,
          instructions: prompt.instructions,
          input: prompt.input,
          maxOutputTokens: agent.parameters.maxOutputTokens,
          temperature: agent.parameters.temperature,
          reasoningEffort: agent.parameters.reasoningEffort,
          sessionKey,
          signal: fence.signal
        });
      } catch (error) {
        fence.throwIfAborted();

        if (!(error instanceof ProviderError) || !error.retryable || attempt >= this.#options.providerRetryLimit) {
          throw error;
        }

        const delayMs = boundedBackoff(this.#options.providerRetryBaseDelayMs, attempt, 10_000);
        attempt += 1;
        await abortableDelay(delayMs, fence.signal);
      }
    }
  }

  private async setPhase(
    job: ClaimedRunJob,
    fence: RunControlFence,
    iteration: PreparedIteration,
    phase: RunPhase
  ): Promise<void> {
    await fence.refresh();
    const accepted = await this.#repository.setPhase(
      job,
      fence.controlVersion,
      iteration,
      phase
    );

    if (accepted) {
      return;
    }

    await fence.refresh();
    const acceptedAfterRefresh = await this.#repository.setPhase(
      job,
      fence.controlVersion,
      iteration,
      phase
    );

    if (!acceptedAfterRefresh) {
      await fence.refresh();
      throw new RoundExecutionError(`Phase ${phase} was rejected by the execution fence`, true);
    }
  }
}

function fulfilledArtifacts(
  settled: readonly { status: "fulfilled" | "rejected"; value?: StoredArtifact }[]
): StoredArtifact[] {
  return settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
}

function hasReachedIterationLimit(snapshot: RunSnapshot): boolean {
  return snapshot.maxIterations !== null && snapshot.currentIteration >= snapshot.maxIterations;
}

function hasReachedTokenLimit(snapshot: RunSnapshot): boolean {
  return (
    snapshot.maxTotalTokens !== null &&
    snapshot.totalInputTokens + snapshot.totalOutputTokens >= snapshot.maxTotalTokens
  );
}

function determineStopReason(
  snapshot: RunSnapshot,
  fence: RunControlFence,
  iterationNumber: number,
  roundTokens: number,
  reviews: readonly StoredArtifact[]
): "graceful_stop" | "paused" | "consensus" | "iteration_limit" | "token_limit" | null {
  if (fence.finishAfterRound) {
    return fence.finishAfterRound;
  }

  if (reviewsHaveConsensus(reviews)) {
    return "consensus";
  }

  if (snapshot.maxIterations !== null && iterationNumber >= snapshot.maxIterations) {
    return "iteration_limit";
  }

  if (
    snapshot.maxTotalTokens !== null &&
    snapshot.totalInputTokens + snapshot.totalOutputTokens + roundTokens >= snapshot.maxTotalTokens
  ) {
    return "token_limit";
  }

  return null;
}

export function reviewsHaveConsensus(reviews: readonly StoredArtifact[]): boolean {
  if (reviews.length < 2) {
    return false;
  }

  return reviews.every((review) => {
    const decision = /(?:^|\n)RELAY_REVIEW_DECISION:\s*(APPROVE|CHANGES_REQUESTED)\s*(?:\n|$)/iu.exec(review.content)?.[1];
    const blockingIssues = /(?:^|\n)RELAY_BLOCKING_ISSUES:\s*(\d+)\s*(?:\n|$)/iu.exec(review.content)?.[1];
    return decision?.toUpperCase() === "APPROVE" && Number(blockingIssues) === 0;
  });
}

function boundedBackoff(baseDelayMs: number, exponent: number, maximumDelayMs: number): number {
  return Math.min(maximumDelayMs, baseDelayMs * 2 ** exponent);
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

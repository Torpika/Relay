import { describe, expect, it, vi } from "vitest";

import { reviewsHaveConsensus, RoundProcessor } from "@/orchestration/processor";
import type { ModelProvider, ModelResponse } from "@/orchestration/providers";
import type {
  ArtifactFailure,
  ArtifactIdentity,
  ArtifactReservation,
  CheckpointInput,
  CheckpointResult,
  ClaimedRunJob,
  OrchestrationRepository,
  PreparedIteration,
  RunControl,
  RunSnapshot,
  StoredArtifact
} from "@/orchestration/types";

describe("RoundProcessor", () => {
  it("runs a finite round and checkpoints exactly one successor", async () => {
    const repository = new MemoryRepository(snapshot());
    const generate = vi.fn(async (request: Parameters<ModelProvider["generate"]>[0]) =>
      response(request.instructions.includes("Synthesize") ? "Synthesis" : "Artifact")
    );
    const processor = processorWith(repository, { generate });

    const result = await processor.process(job());

    expect(result).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(5);
    expect(repository.artifactsByKey.size).toBe(5);
    expect(repository.phases).toEqual([
      "drafting",
      "reviewing",
      "synthesizing",
      "checkpointing"
    ]);
    expect(repository.checkpoints).toHaveLength(1);
    expect(repository.checkpoints[0]).toMatchObject({
      continueRunning: true,
      stopReason: null,
      inputTokens: 5,
      outputTokens: 5
    });
  });

  it("reuses a completed artifact after a retry instead of dispatching it again", async () => {
    const repository = new MemoryRepository(snapshot());
    repository.storeCompleted({ kind: "draft", agentId: "a", targetAgentId: null }, "Recovered draft");
    const generate = vi.fn(async () => response("New artifact"));
    const processor = processorWith(repository, { generate });

    const result = await processor.process(job());

    expect(result).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(4);
    expect(repository.checkpoints).toHaveLength(1);
  });

  it("aborts in-flight work on immediate stop and never accepts the late result", async () => {
    const repository = new MemoryRepository(snapshot());
    const generate = vi.fn((request: Parameters<ModelProvider["generate"]>[0]) => {
      repository.control = { controlVersion: 2, desiredState: "stopped", stopMode: "immediate" };
      return new Promise<ModelResponse>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
      });
    });
    const processor = processorWith(repository, { generate }, 1);

    const result = await processor.process(job());

    expect(result).toBe("cancelled");
    expect(repository.completedArtifactCount).toBe(0);
    expect(repository.checkpoints).toHaveLength(0);
    expect(repository.cancelReasons).toEqual(["immediate_stop"]);
  });

  it("adopts a graceful stop epoch, finishes the round, and schedules no successor", async () => {
    const repository = new MemoryRepository(snapshot());
    let changedControl = false;
    const generate = vi.fn(async () => {
      if (!changedControl) {
        changedControl = true;
        repository.control = { controlVersion: 2, desiredState: "stopped", stopMode: "graceful" };
      }

      return response("Artifact");
    });
    const processor = processorWith(repository, { generate }, 5);

    const result = await processor.process(job());

    expect(result).toBe("completed");
    expect(repository.checkpoints).toHaveLength(1);
    expect(repository.checkpoints[0]).toMatchObject({
      controlVersion: 2,
      continueRunning: false,
      stopReason: "graceful_stop"
    });
  });
});

describe("reviewsHaveConsensus", () => {
  it("requires every reviewer to approve with zero blocking issues", () => {
    const approved = reviewArtifact("Analysis\nRELAY_REVIEW_DECISION: APPROVE\nRELAY_BLOCKING_ISSUES: 0");

    expect(reviewsHaveConsensus([approved, approved])).toBe(true);
    expect(reviewsHaveConsensus([approved])).toBe(false);
    expect(reviewsHaveConsensus([
      approved,
      reviewArtifact("RELAY_REVIEW_DECISION: CHANGES_REQUESTED\nRELAY_BLOCKING_ISSUES: 1")
    ])).toBe(false);
  });

  it("fails closed when a review omits the structured decision", () => {
    expect(reviewsHaveConsensus([reviewArtifact("Looks good"), reviewArtifact("Approved")])).toBe(false);
  });
});

class MemoryRepository implements OrchestrationRepository {
  readonly artifactsByKey = new Map<string, StoredArtifact>();
  readonly phases: string[] = [];
  readonly checkpoints: CheckpointInput[] = [];
  readonly cancelReasons: string[] = [];
  completedArtifactCount = 0;
  control: RunControl;
  #artifactSequence = 0;
  readonly #snapshot: RunSnapshot;

  constructor(runSnapshot: RunSnapshot) {
    this.#snapshot = runSnapshot;
    this.control = {
      controlVersion: runSnapshot.controlVersion,
      desiredState: runSnapshot.desiredState,
      stopMode: runSnapshot.stopMode
    };
  }

  async claimNextJob(): Promise<ClaimedRunJob | null> {
    return null;
  }

  async renewJobLease(): Promise<boolean> {
    return true;
  }

  async loadRunSnapshot(): Promise<RunSnapshot> {
    return this.#snapshot;
  }

  async getRunControl(): Promise<RunControl> {
    return this.control;
  }

  async prepareIteration(
    _job: ClaimedRunJob,
    controlVersion: number,
    iterationNumber: number
  ): Promise<PreparedIteration | null> {
    return controlVersion === this.control.controlVersion
      ? { id: "iteration-1", number: iterationNumber }
      : null;
  }

  async setPhase(
    _job: ClaimedRunJob,
    controlVersion: number,
    _iteration: PreparedIteration,
    phase: Parameters<OrchestrationRepository["setPhase"]>[3]
  ): Promise<boolean> {
    if (!this.accepts(controlVersion)) {
      return false;
    }

    this.phases.push(phase);
    return true;
  }

  async reserveArtifact(
    _job: ClaimedRunJob,
    controlVersion: number,
    _iteration: PreparedIteration,
    identity: ArtifactIdentity
  ): Promise<ArtifactReservation | null> {
    if (!this.accepts(controlVersion)) {
      return null;
    }

    const key = artifactKey(identity);
    const existing = this.artifactsByKey.get(key);

    if (existing?.status === "complete") {
      return { state: "complete", artifact: existing };
    }

    const artifact: StoredArtifact = existing ?? {
      ...identity,
      id: `artifact-${++this.#artifactSequence}`,
      content: "",
      status: "running",
      latencyMs: null,
      inputTokens: 0,
      outputTokens: 0,
      error: null
    };
    artifact.status = "running";
    this.artifactsByKey.set(key, artifact);
    return { state: "acquired", artifact };
  }

  async completeArtifact(
    _job: ClaimedRunJob,
    controlVersion: number,
    _iteration: PreparedIteration,
    artifactId: string,
    modelResponse: ModelResponse
  ): Promise<StoredArtifact | null> {
    if (!this.accepts(controlVersion)) {
      return null;
    }

    const artifact = [...this.artifactsByKey.values()].find((candidate) => candidate.id === artifactId);

    if (!artifact) {
      return null;
    }

    Object.assign(artifact, {
      content: modelResponse.content,
      status: "complete",
      latencyMs: modelResponse.latencyMs,
      inputTokens: modelResponse.usage.inputTokens,
      outputTokens: modelResponse.usage.outputTokens,
      error: null
    });
    this.completedArtifactCount += 1;
    return artifact;
  }

  async failArtifact(
    _job: ClaimedRunJob,
    _controlVersion: number,
    _iteration: PreparedIteration,
    artifactId: string,
    failure: ArtifactFailure,
    cancelled: boolean
  ): Promise<boolean> {
    const artifact = [...this.artifactsByKey.values()].find((candidate) => candidate.id === artifactId);

    if (!artifact) {
      return false;
    }

    artifact.status = cancelled ? "cancelled" : "failed";
    artifact.error = failure.message;
    return true;
  }

  async checkpointRound(input: CheckpointInput): Promise<CheckpointResult> {
    if (!this.accepts(input.controlVersion)) {
      return { accepted: false, scheduledNext: false };
    }

    this.checkpoints.push(input);
    return { accepted: true, scheduledNext: input.continueRunning };
  }

  async cancelIteration(
    _job: ClaimedRunJob,
    _controlVersion: number,
    _iteration: PreparedIteration | null,
    reason: string
  ): Promise<void> {
    this.cancelReasons.push(reason);
  }

  async completeObsoleteJob(): Promise<void> {}
  async retryJob(): Promise<void> {}
  async failJob(): Promise<void> {}

  storeCompleted(identity: ArtifactIdentity, content: string): void {
    this.artifactsByKey.set(artifactKey(identity), {
      ...identity,
      id: `artifact-${++this.#artifactSequence}`,
      content,
      status: "complete",
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      error: null
    });
  }

  private accepts(controlVersion: number): boolean {
    return (
      controlVersion === this.control.controlVersion &&
      (this.control.desiredState === "running" ||
        this.control.desiredState === "paused" ||
        (this.control.desiredState === "stopped" && this.control.stopMode === "graceful"))
    );
  }
}

function processorWith(
  repository: OrchestrationRepository,
  provider: ModelProvider,
  controlPollIntervalMs = 50
): RoundProcessor {
  return new RoundProcessor(repository, {
    providerFactory: () => provider,
    controlPollIntervalMs,
    providerRetryBaseDelayMs: 1,
    jobRetryBaseDelayMs: 1
  });
}

function job(): ClaimedRunJob {
  return {
    id: "1",
    workspaceId: "workspace",
    runId: "run",
    iterationId: null,
    type: "reconcile_run",
    controlVersion: 1,
    attempts: 1,
    maxAttempts: 3,
    leaseOwner: "worker",
    leaseToken: "00000000-0000-4000-8000-000000000001"
  };
}

function snapshot(): RunSnapshot {
  return {
    workspaceId: "workspace",
    runId: "run",
    conversationId: "conversation",
    controlVersion: 1,
    desiredState: "running",
    stopMode: null,
    currentIteration: 0,
    objective: "Solve the task",
    pendingInstruction: null,
    previousSynthesis: null,
    synthesizerAgentId: "a",
    reviewTopology: "all_to_all",
    maxIterations: null,
    maxTotalTokens: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    agents: [agent("a", 0), agent("b", 1)]
  };
}

function agent(id: string, position: number) {
  return {
    id,
    name: id.toUpperCase(),
    model: "model",
    roles: ["draft", "review", "synthesize"] as const,
    instructions: "",
    position,
    parameters: {},
    connection: {
      id: `connection-${id}`,
      kind: "custom" as const,
      protocol: "chat_completions" as const,
      baseUrl: "https://provider.example/v1",
      credential: "secret"
    }
  };
}

function response(content: string): ModelResponse {
  return {
    content,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    latencyMs: 1,
    providerResponseId: null,
    providerRequestId: null
  };
}

function reviewArtifact(content: string): StoredArtifact {
  return {
    id: crypto.randomUUID(),
    kind: "review",
    agentId: "reviewer",
    targetAgentId: "author",
    content,
    status: "complete",
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    error: null
  };
}

function artifactKey(identity: ArtifactIdentity): string {
  return `${identity.kind}:${identity.agentId ?? "none"}:${identity.targetAgentId ?? "none"}`;
}

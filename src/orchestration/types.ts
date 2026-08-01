import type { AgentRole, ProviderProtocol, ReasoningEffort, RunPhase } from "@/lib/contracts";
import type { ModelResponse, ProviderErrorCode } from "@/orchestration/providers";

export type DesiredState = "running" | "paused" | "stopped";
export type StopMode = "graceful" | "immediate" | null;
export type ReviewTopology = "all_to_all" | "round_robin";
export type ArtifactKind = "draft" | "review" | "synthesis";

export interface ClaimedRunJob {
  id: string;
  workspaceId: string;
  runId: string;
  iterationId: string | null;
  type: "reconcile_run";
  controlVersion: number;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseToken: string;
}

export interface AgentParameters {
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ExecutionAgent {
  id: string;
  name: string;
  model: string;
  roles: readonly AgentRole[];
  instructions: string;
  position: number;
  parameters: AgentParameters;
  connection: {
    id: string;
    kind: import("@/lib/contracts").ProviderKind;
    protocol: ProviderProtocol;
    baseUrl: string;
    credential?: string;
  };
}

export interface RunSnapshot {
  workspaceId: string;
  runId: string;
  conversationId: string;
  controlVersion: number;
  desiredState: DesiredState;
  stopMode: StopMode;
  currentIteration: number;
  objective: string;
  pendingInstruction: string | null;
  previousSynthesis: string | null;
  synthesizerAgentId: string;
  reviewTopology: ReviewTopology;
  maxIterations: number | null;
  maxTotalTokens: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  agents: ExecutionAgent[];
}

export interface RunControl {
  controlVersion: number;
  desiredState: DesiredState;
  stopMode: StopMode;
}

export interface PreparedIteration {
  id: string;
  number: number;
}

export interface ArtifactIdentity {
  kind: ArtifactKind;
  agentId: string | null;
  targetAgentId: string | null;
}

export interface StoredArtifact extends ArtifactIdentity {
  id: string;
  content: string;
  status: "pending" | "running" | "complete" | "failed" | "cancelled";
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
}

export interface ArtifactReservation {
  state: "acquired" | "complete" | "busy";
  artifact: StoredArtifact;
}

export interface ArtifactFailure {
  message: string;
  code: ProviderErrorCode | "orchestration";
  retryable: boolean;
}

export interface CheckpointInput {
  job: ClaimedRunJob;
  controlVersion: number;
  iteration: PreparedIteration;
  synthesis: StoredArtifact;
  inputTokens: number;
  outputTokens: number;
  continueRunning: boolean;
  stopReason: "graceful_stop" | "paused" | "consensus" | "iteration_limit" | "token_limit" | null;
}

export interface CheckpointResult {
  accepted: boolean;
  scheduledNext: boolean;
}

export interface OrchestrationRepository {
  claimNextJob(workerId: string, leaseMs: number): Promise<ClaimedRunJob | null>;
  renewJobLease(job: ClaimedRunJob, leaseMs: number): Promise<boolean>;
  loadRunSnapshot(job: ClaimedRunJob): Promise<RunSnapshot | null>;
  getRunControl(workspaceId: string, runId: string): Promise<RunControl | null>;
  prepareIteration(
    job: ClaimedRunJob,
    controlVersion: number,
    iterationNumber: number
  ): Promise<PreparedIteration | null>;
  setPhase(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    phase: RunPhase
  ): Promise<boolean>;
  reserveArtifact(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    identity: ArtifactIdentity
  ): Promise<ArtifactReservation | null>;
  completeArtifact(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    artifactId: string,
    response: ModelResponse,
    draftArtifactId?: string
  ): Promise<StoredArtifact | null>;
  failArtifact(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration,
    artifactId: string,
    failure: ArtifactFailure,
    cancelled: boolean
  ): Promise<boolean>;
  checkpointRound(input: CheckpointInput): Promise<CheckpointResult>;
  cancelIteration(
    job: ClaimedRunJob,
    controlVersion: number,
    iteration: PreparedIteration | null,
    reason: string
  ): Promise<void>;
  completeObsoleteJob(job: ClaimedRunJob, reason: string): Promise<void>;
  retryJob(job: ClaimedRunJob, error: string, delayMs: number): Promise<void>;
  failJob(job: ClaimedRunJob, error: string): Promise<void>;
}

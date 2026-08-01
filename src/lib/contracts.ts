export const runStatuses = [
  "created",
  "starting",
  "running",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "stopped",
  "needs_attention",
  "failed"
] as const;

export type RunStatus = (typeof runStatuses)[number];

export const runPhases = [
  "preparing",
  "drafting",
  "reviewing",
  "synthesizing",
  "checkpointing",
  "idle"
] as const;

export type RunPhase = (typeof runPhases)[number];

export const providerKinds = [
  "local_codex",
  "local_claude",
  "local_gemini",
  "local_kimi",
  "openai",
  "xai",
  "moonshot",
  "custom"
] as const;

export type ProviderKind = (typeof providerKinds)[number];

export const providerProtocols = ["codex_mcp", "local_cli", "responses", "chat_completions"] as const;

export type ProviderProtocol = (typeof providerProtocols)[number];

export type AgentRole = "draft" | "review" | "synthesize";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentParametersSummary {
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface Viewer {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "operator" | "viewer";
}

export interface ProviderConnectionSummary {
  id: string;
  name: string;
  kind: ProviderKind;
  protocol: ProviderProtocol;
  baseUrl: string;
  maskedCredential: string;
  status: "untested" | "healthy" | "unhealthy" | "disabled";
  lastCheckedAt: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  model: string;
  providerKind: ProviderKind;
  connectionId: string;
  roles: AgentRole[];
  instructions: string;
  enabled: boolean;
  color: string;
  parameters: AgentParametersSummary;
}

export interface ConversationSummary {
  id: string;
  title: string;
  objective: string;
  status: RunStatus | "idle";
  phase: RunPhase;
  iteration: number;
  agentCount: number;
  updatedAt: string;
  totalTokens: number;
}

export interface ArtifactSummary {
  id: string;
  kind: "draft" | "review" | "synthesis";
  agentId: string | null;
  agentName: string;
  targetAgentId: string | null;
  targetAgentName: string | null;
  content: string;
  status: "pending" | "running" | "complete" | "failed" | "cancelled";
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface IterationDetail {
  id: string;
  number: number;
  phase: RunPhase;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  synthesis: string | null;
  artifacts: ArtifactSummary[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunDetail {
  id: string;
  conversationId: string;
  status: RunStatus;
  desiredState: "running" | "paused" | "stopped";
  phase: RunPhase;
  currentIteration: number;
  synthesizerAgentId: string;
  reviewTopology: "all_to_all" | "round_robin";
  maxIterations: number | null;
  maxTotalTokens: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  consecutiveFailures: number;
  stopMode: "graceful" | "immediate" | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  run: RunDetail | null;
  agents: AgentSummary[];
  iterations: IterationDetail[];
  pendingInstruction: string | null;
}

export interface DashboardPayload {
  viewer: Viewer;
  conversations: ConversationSummary[];
  agents: AgentSummary[];
  connections: ProviderConnectionSummary[];
}

export interface DomainEvent {
  id: number;
  type: string;
  runId: string | null;
  iterationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

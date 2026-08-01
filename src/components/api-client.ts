import type {
  AgentRole,
  AgentSummary,
  ConversationDetail,
  DashboardPayload,
  DomainEvent,
  ProviderConnectionSummary,
  ProviderKind,
  ProviderProtocol,
  ReasoningEffort,
  RunDetail
} from "@/lib/contracts";
import type { LocalThreadDiscoveryPayload, LocalThreadImport } from "@/local/threads/types";

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error?.message ?? "The request could not be completed.");
    this.name = "ApiError";
    this.status = status;
    this.code = payload.error?.code ?? "unknown_error";
    this.details = payload.error?.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    let payload: ApiErrorPayload = {};

    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      payload = {};
    }

    throw new ApiError(response.status, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface CreateProviderInput {
  name: string;
  kind: ProviderKind;
  protocol: ProviderProtocol;
  baseUrl: string;
  credential?: string;
}

export interface CreateAgentInput {
  name: string;
  model: string;
  connectionId: string;
  roles: AgentRole[];
  instructions: string;
  color: string;
  enabled: boolean;
  parameters?: {
    reasoningEffort?: ReasoningEffort;
  };
}

export interface CreateConversationInput {
  title: string;
  objective: string;
  agentIds: string[];
}

export interface StartRunInput {
  synthesizerAgentId: string;
  reviewTopology: "all_to_all" | "round_robin";
  maxIterations?: number | null;
  maxTotalTokens?: number | null;
}

export const relayApi = {
  getDashboard: () => request<DashboardPayload>("/api/dashboard"),
  getLocalThreads: () => request<LocalThreadDiscoveryPayload>("/api/local-threads"),
  importLocalThread: (threadId: string) => request<LocalThreadImport>("/api/local-threads", {
    method: "POST",
    body: JSON.stringify({ threadId })
  }),
  getConversation: (conversationId: string) =>
    request<ConversationDetail>(`/api/conversations/${encodeURIComponent(conversationId)}`),
  createProvider: (input: CreateProviderInput) =>
    request<ProviderConnectionSummary>("/api/providers", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  testProvider: (providerId: string) =>
    request<ProviderConnectionSummary>(`/api/providers/${encodeURIComponent(providerId)}/test`, {
      method: "POST"
    }),
  createAgent: (input: CreateAgentInput) =>
    request<AgentSummary>("/api/agents", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  createConversation: (input: CreateConversationInput) =>
    request<ConversationDetail>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  startRun: (conversationId: string, input: StartRunInput | Record<string, never> = {}) =>
    request<{ run: RunDetail }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/runs`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  pauseRun: (runId: string) =>
    request<RunDetail>(`/api/runs/${encodeURIComponent(runId)}/pause`, { method: "POST" }),
  resumeRun: (runId: string) =>
    request<RunDetail>(`/api/runs/${encodeURIComponent(runId)}/resume`, { method: "POST" }),
  stopRun: (runId: string, mode: "graceful" | "immediate" = "graceful") =>
    request<RunDetail>(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ mode })
    }),
  queueInstruction: (runId: string, instruction: string) =>
    request<{ pendingInstruction: string }>(`/api/runs/${encodeURIComponent(runId)}/instructions`, {
      method: "POST",
      body: JSON.stringify({ instruction })
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" })
};

export function subscribeToConversation(
  conversationId: string,
  onEvent: (event: DomainEvent) => void,
  onConnectionChange: (connected: boolean) => void
): () => void {
  if (typeof EventSource === "undefined") {
    onConnectionChange(false);
    return () => undefined;
  }

  const eventSource = new EventSource(`/api/events?conversationId=${encodeURIComponent(conversationId)}`);

  eventSource.onopen = () => onConnectionChange(true);
  eventSource.onerror = () => onConnectionChange(false);
  eventSource.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as DomainEvent);
    } catch {
      onConnectionChange(false);
    }
  };

  return () => eventSource.close();
}

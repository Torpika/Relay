import type { ProviderKind, ProviderProtocol, ReasoningEffort } from "@/lib/contracts";

export interface ProviderConnection {
  id: string;
  kind: ProviderKind;
  protocol: ProviderProtocol;
  baseUrl: string;
  credential?: string;
  headers?: Readonly<Record<string, string>>;
}

export interface ModelRequest {
  model: string;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  sessionKey?: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}

export interface ModelResponse {
  content: string;
  usage: TokenUsage;
  latencyMs: number;
  providerResponseId: string | null;
  providerRequestId: string | null;
}

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface ProviderClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  destinationValidator?: (baseUrl: string) => Promise<void>;
}

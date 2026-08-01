import { ProviderError } from "@/orchestration/providers/errors";
import { isRecord, ProviderHttpClient } from "@/orchestration/providers/http";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderClientOptions,
  ProviderConnection,
  TokenUsage
} from "@/orchestration/providers/types";

export class ChatCompletionsProvider implements ModelProvider {
  readonly #http: ProviderHttpClient;

  constructor(connection: ProviderConnection, options: ProviderClientOptions = {}) {
    this.#http = new ProviderHttpClient(connection, options);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = performance.now();
    const requestBody: Record<string, unknown> = {
      model: request.model,
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: request.input }
      ],
      stream: false
    };

    if (request.maxOutputTokens !== undefined) {
      requestBody.max_tokens = request.maxOutputTokens;
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    if (request.reasoningEffort !== undefined) {
      requestBody.reasoning_effort = request.reasoningEffort;
    }

    const response = await this.#http.post("chat/completions", requestBody, request.signal);
    const responseBody = response.body;

    if (!isRecord(responseBody)) {
      throw malformedResponse("Provider returned an invalid Chat Completions payload");
    }

    const content = extractChatCompletionsText(responseBody);

    if (!content) {
      throw malformedResponse("Provider response did not contain assistant text");
    }

    return {
      content,
      usage: extractChatUsage(responseBody.usage),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      providerResponseId: typeof responseBody.id === "string" ? responseBody.id : null,
      providerRequestId: response.headers.get("x-request-id")
    };
  }
}

export function extractChatCompletionsText(response: Record<string, unknown>): string {
  const choices = response.choices;

  if (!Array.isArray(choices)) {
    return "";
  }

  const textParts: string[] = [];

  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      continue;
    }

    const content = choice.message.content;

    if (typeof content === "string") {
      textParts.push(content);
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function extractChatUsage(value: unknown): TokenUsage {
  if (!isRecord(value)) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  const inputTokens = nonNegativeInteger(value.prompt_tokens);
  const outputTokens = nonNegativeInteger(value.completion_tokens);
  const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: nonNegativeInteger(value.total_tokens) || inputTokens + outputTokens,
    ...(promptDetails
      ? { cachedInputTokens: nonNegativeInteger(promptDetails.cached_tokens) }
      : {})
  };
}

function malformedResponse(message: string): ProviderError {
  return new ProviderError(message, {
    code: "malformed_response",
    retryable: false
  });
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

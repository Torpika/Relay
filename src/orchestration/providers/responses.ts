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

export class ResponsesProvider implements ModelProvider {
  readonly #http: ProviderHttpClient;

  constructor(connection: ProviderConnection, options: ProviderClientOptions = {}) {
    this.#http = new ProviderHttpClient(connection, options);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = performance.now();
    const requestBody: Record<string, unknown> = {
      model: request.model,
      instructions: request.instructions,
      input: request.input,
      store: false
    };

    if (request.maxOutputTokens !== undefined) {
      requestBody.max_output_tokens = request.maxOutputTokens;
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    if (request.reasoningEffort !== undefined) {
      requestBody.reasoning = { effort: request.reasoningEffort };
    }

    const response = await this.#http.post("responses", requestBody, request.signal);
    const responseBody = response.body;

    if (!isRecord(responseBody)) {
      throw malformedResponse("Provider returned an invalid Responses API payload");
    }

    const content = extractResponsesText(responseBody);

    if (!content) {
      throw malformedResponse("Provider response did not contain text output");
    }

    return {
      content,
      usage: extractResponsesUsage(responseBody.usage),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      providerResponseId: typeof responseBody.id === "string" ? responseBody.id : null,
      providerRequestId: response.headers.get("x-request-id")
    };
  }
}

export function extractResponsesText(response: Record<string, unknown>): string {
  const output = response.output;

  if (!Array.isArray(output)) {
    return "";
  }

  const textParts: string[] = [];

  for (const item of output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (!isRecord(contentItem)) {
        continue;
      }

      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        textParts.push(contentItem.text);
      } else if (contentItem.type === "refusal" && typeof contentItem.refusal === "string") {
        textParts.push(contentItem.refusal);
      }
    }
  }

  return textParts.join("\n").trim();
}

function extractResponsesUsage(value: unknown): TokenUsage {
  if (!isRecord(value)) {
    return emptyUsage();
  }

  const inputTokens = nonNegativeInteger(value.input_tokens);
  const outputTokens = nonNegativeInteger(value.output_tokens);
  const inputDetails = isRecord(value.input_tokens_details) ? value.input_tokens_details : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: nonNegativeInteger(value.total_tokens) || inputTokens + outputTokens,
    ...(inputDetails
      ? { cachedInputTokens: nonNegativeInteger(inputDetails.cached_tokens) }
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

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

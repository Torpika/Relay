import { ProviderError, type ProviderErrorCode } from "@/orchestration/providers/errors";
import type { ProviderConnection } from "@/orchestration/providers/types";
import {
  assertSafeProviderDestination,
  normalizeProviderBaseUrl
} from "@/server/security/provider-url";
import { ApiError } from "@/server/http/errors";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

interface ProviderHttpClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  destinationValidator?: (baseUrl: string) => Promise<void>;
}

export interface ProviderJsonResponse {
  body: unknown;
  headers: Headers;
}

export class ProviderHttpClient {
  readonly #connection: ProviderConnection;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #destinationValidator: (baseUrl: string) => Promise<void>;

  constructor(connection: ProviderConnection, options: ProviderHttpClientOptions = {}) {
    this.#connection = connection;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
    this.#destinationValidator = options.destinationValidator ?? assertSafeProviderDestination;

    if (!this.#fetch) {
      throw new Error("A Fetch API implementation is required");
    }
  }

  async post(path: string, body: unknown, signal?: AbortSignal): Promise<ProviderJsonResponse> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort("provider_timeout"), this.#timeoutMs);
    const combinedSignal = combineAbortSignals(signal, timeoutController.signal);

    try {
      throwIfRequestCancelled(signal, timeoutController.signal, this.#timeoutMs);
      const normalizedBaseUrl = normalizeProviderBaseUrl(
        this.#connection.kind,
        this.#connection.baseUrl
      );
      await this.#destinationValidator(normalizedBaseUrl);
      throwIfRequestCancelled(signal, timeoutController.signal, this.#timeoutMs);
      const url = resolveProviderUrl(normalizedBaseUrl, path);
      const response = await this.#fetch(url, {
        method: "POST",
        headers: {
          ...this.#connection.headers,
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.#connection.credential}`
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: combinedSignal
      });
      const responseBody = await parseResponseBody(response, this.#maxResponseBytes);
      const requestId = response.headers.get("x-request-id");

      if (!response.ok) {
        const errorMessage = extractErrorMessage(responseBody, response.statusText);
        const classification = classifyHttpStatus(response.status);

        throw new ProviderError(errorMessage, {
          ...classification,
          status: response.status,
          providerRequestId: requestId
        });
      }

      return { body: responseBody, headers: response.headers };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (timeoutController.signal.aborted && !signal?.aborted) {
        throw new ProviderError(`Provider request timed out after ${this.#timeoutMs}ms`, {
          code: "timeout",
          retryable: true,
          cause: error
        });
      }

      if (error instanceof ApiError) {
        throw new ProviderError(error.message, {
          code: "invalid_request",
          retryable: false,
          cause: error
        });
      }

      if (signal?.aborted) {
        throw new ProviderError("Provider request was cancelled", {
          code: "cancelled",
          retryable: false,
          cause: error
        });
      }

      throw new ProviderError("Provider request failed before receiving a response", {
        code: "network",
        retryable: true,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function throwIfRequestCancelled(
  externalSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  timeoutMs: number
): void {
  if (externalSignal?.aborted) {
    throw new ProviderError("Provider request was cancelled", {
      code: "cancelled",
      retryable: false,
      cause: externalSignal.reason
    });
  }

  if (timeoutSignal.aborted) {
    throw new ProviderError(`Provider request timed out after ${timeoutMs}ms`, {
      code: "timeout",
      retryable: true,
      cause: timeoutSignal.reason
    });
  }
}

export function resolveProviderUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  let base: URL;

  try {
    base = new URL(normalizedBaseUrl);
  } catch {
    throw new ProviderError("Provider base URL is invalid", {
      code: "invalid_request",
      retryable: false
    });
  }

  const isLocalHttp =
    base.protocol === "http:" && (base.hostname === "localhost" || base.hostname === "127.0.0.1");

  if (base.protocol !== "https:" && !isLocalHttp) {
    throw new ProviderError("Provider base URL must use HTTPS", {
      code: "invalid_request",
      retryable: false
    });
  }

  if (base.username || base.password) {
    throw new ProviderError("Provider base URL must not contain credentials", {
      code: "invalid_request",
      retryable: false
    });
  }

  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const relativePath = path.replace(/^\/+/, "");
  base.pathname = `${basePath}${relativePath}`.replace(/\/{2,}/g, "/");
  base.search = "";
  base.hash = "";
  return base;
}

function combineAbortSignals(external: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!external) {
    return timeout;
  }

  return AbortSignal.any([external, timeout]);
}

async function parseResponseBody(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);

  if (declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new ProviderError(`Provider response exceeded ${maximumBytes} bytes`, {
      code: "malformed_response",
      retryable: false,
      status: response.status,
      providerRequestId: response.headers.get("x-request-id")
    });
  }

  const text = await readBoundedText(response, maximumBytes);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (response.ok) {
      throw new ProviderError("Provider returned a non-JSON response", {
        code: "malformed_response",
        retryable: false,
        status: response.status,
        providerRequestId: response.headers.get("x-request-id")
      });
    }

    return text;
  }
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      return text + decoder.decode();
    }

    totalBytes += chunk.value.byteLength;

    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ProviderError(`Provider response exceeded ${maximumBytes} bytes`, {
        code: "malformed_response",
        retryable: false,
        status: response.status,
        providerRequestId: response.headers.get("x-request-id")
      });
    }

    text += decoder.decode(chunk.value, { stream: true });
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  let message = fallback || "Provider request failed";

  if (typeof body === "string") {
    message = body;
  } else if (isRecord(body)) {
    const nestedError = body.error;

    if (typeof nestedError === "string") {
      message = nestedError;
    } else if (isRecord(nestedError) && typeof nestedError.message === "string") {
      message = nestedError.message;
    } else if (typeof body.message === "string") {
      message = body.message;
    }
  }

  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function classifyHttpStatus(status: number): { code: ProviderErrorCode; retryable: boolean } {
  if (status === 401) {
    return { code: "authentication", retryable: false };
  }

  if (status === 403) {
    return { code: "authorization", retryable: false };
  }

  if (status === 404) {
    return { code: "not_found", retryable: false };
  }

  if (status === 408 || status === 429) {
    return { code: status === 429 ? "rate_limit" : "timeout", retryable: true };
  }

  if (status >= 500) {
    return { code: "server_error", retryable: true };
  }

  if (status >= 400) {
    return { code: "invalid_request", retryable: false };
  }

  return { code: "unknown", retryable: false };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

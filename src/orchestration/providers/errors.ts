export type ProviderErrorCode =
  | "authentication"
  | "authorization"
  | "cancelled"
  | "invalid_request"
  | "malformed_response"
  | "network"
  | "not_found"
  | "rate_limit"
  | "server_error"
  | "timeout"
  | "unknown";

export interface ProviderErrorOptions {
  code: ProviderErrorCode;
  retryable: boolean;
  status?: number;
  providerRequestId?: string | null;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly providerRequestId: string | null;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.providerRequestId = options.providerRequestId ?? null;
  }
}

export function asProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof Error) {
    return new ProviderError(error.message, {
      code: "unknown",
      retryable: false,
      cause: error
    });
  }

  return new ProviderError("Unknown provider failure", {
    code: "unknown",
    retryable: false,
    cause: error
  });
}

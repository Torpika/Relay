export class RoundExecutionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "RoundExecutionError";
    this.retryable = retryable;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Unknown orchestration failure";
}

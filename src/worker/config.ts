export interface WorkerConfig {
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  shutdownGraceMs: number;
  providerRequestTimeoutMs: number;
}

export function loadWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): WorkerConfig {
  return {
    workerId: environment.WORKER_ID?.trim() || `relay-worker-${crypto.randomUUID()}`,
    concurrency: positiveInteger(environment.WORKER_CONCURRENCY, 2, "WORKER_CONCURRENCY"),
    pollIntervalMs: positiveInteger(environment.WORKER_POLL_INTERVAL_MS, 1_000, "WORKER_POLL_INTERVAL_MS"),
    leaseMs: positiveInteger(
      environment.JOB_LEASE_MS ?? environment.WORKER_LEASE_MS,
      180_000,
      "JOB_LEASE_MS"
    ),
    shutdownGraceMs: positiveInteger(
      environment.WORKER_SHUTDOWN_GRACE_MS,
      30_000,
      "WORKER_SHUTDOWN_GRACE_MS"
    ),
    providerRequestTimeoutMs: positiveInteger(
      environment.PROVIDER_REQUEST_TIMEOUT_MS,
      120_000,
      "PROVIDER_REQUEST_TIMEOUT_MS"
    )
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

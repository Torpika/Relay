import { describe, expect, it } from "vitest";

import { loadWorkerConfig } from "@/worker/config";

describe("loadWorkerConfig", () => {
  it("uses production-safe defaults", () => {
    const config = loadWorkerConfig({});

    expect(config).toMatchObject({
      concurrency: 2,
      pollIntervalMs: 1_000,
      leaseMs: 180_000,
      shutdownGraceMs: 30_000,
      providerRequestTimeoutMs: 120_000
    });
    expect(config.workerId).toMatch(/^relay-worker-/);
  });

  it("prefers JOB_LEASE_MS while retaining the legacy alias", () => {
    expect(loadWorkerConfig({ JOB_LEASE_MS: "9000", WORKER_LEASE_MS: "8000" }).leaseMs).toBe(
      9_000
    );
    expect(loadWorkerConfig({ WORKER_LEASE_MS: "8000" }).leaseMs).toBe(8_000);
  });

  it.each([
    ["WORKER_CONCURRENCY", "0"],
    ["WORKER_POLL_INTERVAL_MS", "1.5"],
    ["JOB_LEASE_MS", "not-a-number"],
    ["PROVIDER_REQUEST_TIMEOUT_MS", "0"],
    ["WORKER_SHUTDOWN_GRACE_MS", "-1"]
  ])("rejects an invalid %s", (name, value) => {
    expect(() => loadWorkerConfig({ [name]: value })).toThrow("must be a positive integer");
  });
});

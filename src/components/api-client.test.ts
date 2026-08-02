import { afterEach, describe, expect, it, vi } from "vitest";
import { relayApi, verifyProviderConnections } from "@/components/api-client";
import type { ProviderConnectionSummary } from "@/lib/contracts";

afterEach(() => vi.restoreAllMocks());

function connection(id: string, status: ProviderConnectionSummary["status"]): ProviderConnectionSummary {
  return {
    id,
    name: `Runtime ${id}`,
    kind: "local_codex",
    protocol: "codex_mcp",
    baseUrl: "local://codex",
    maskedCredential: "ChatGPT login",
    status,
    lastCheckedAt: "2026-08-02T00:00:00.000Z"
  };
}

describe("verifyProviderConnections", () => {
  it("tests each selected runtime once before launching a run", async () => {
    const testProvider = vi.spyOn(relayApi, "testProvider")
      .mockResolvedValueOnce(connection("codex", "healthy"))
      .mockResolvedValueOnce(connection("claude", "healthy"));

    await expect(verifyProviderConnections(["codex", "claude", "codex"]))
      .resolves.toEqual([connection("codex", "healthy"), connection("claude", "healthy")]);

    expect(testProvider).toHaveBeenCalledTimes(2);
    expect(testProvider).toHaveBeenNthCalledWith(1, "codex");
    expect(testProvider).toHaveBeenNthCalledWith(2, "claude");
  });

  it("blocks launch when any selected runtime is not healthy", async () => {
    vi.spyOn(relayApi, "testProvider")
      .mockResolvedValueOnce(connection("codex", "healthy"))
      .mockResolvedValueOnce(connection("kimi", "unhealthy"));

    await expect(verifyProviderConnections(["codex", "kimi"]))
      .rejects.toMatchObject({
        name: "ProviderReadinessError",
        connections: [connection("kimi", "unhealthy")]
      });
  });
});

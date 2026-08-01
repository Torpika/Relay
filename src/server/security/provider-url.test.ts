import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeProviderBaseUrl } from "@/server/security/provider-url";

const environmentKeys = ["CUSTOM_PROVIDER_HOSTS", "ALLOW_PRIVATE_PROVIDER_URLS"] as const;

describe("provider URL policy", () => {
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of environmentKeys) {
      originalEnvironment.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("pins built-in providers to their official base URL", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(normalizeProviderBaseUrl("openai", "https://api.openai.com/v1/"))
      .toBe("https://api.openai.com/v1");
    expect(() => normalizeProviderBaseUrl("openai", "https://proxy.example/v1"))
      .toThrow("must use https://api.openai.com/v1");
  });

  it("requires a production allowlist for custom providers", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => normalizeProviderBaseUrl("custom", "https://models.example/v1"))
      .toThrow("not allowlisted");
    process.env.CUSTOM_PROVIDER_HOSTS = "models.example";
    expect(normalizeProviderBaseUrl("custom", "https://models.example/v1"))
      .toBe("https://models.example/v1");
  });

  it("only permits local HTTP endpoints behind the explicit development gate", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(() => normalizeProviderBaseUrl("custom", "http://localhost:11434/v1"))
      .toThrow("must use HTTPS");
    process.env.ALLOW_PRIVATE_PROVIDER_URLS = "true";
    expect(normalizeProviderBaseUrl("custom", "http://localhost:11434/v1"))
      .toBe("http://localhost:11434/v1");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthMode, localDevelopmentAuthEnabled } from "@/server/auth/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication configuration", () => {
  it("allows explicitly enabled local authentication for a loopback app URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("ALLOW_LOCAL_DEVELOPMENT_AUTH", "true");
    vi.stubEnv("APP_URL", "http://localhost:3000");

    expect(localDevelopmentAuthEnabled()).toBe(true);
    expect(getAuthMode()).toBe("development");
  });

  it("rejects local authentication without an explicit opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("ALLOW_LOCAL_DEVELOPMENT_AUTH", "false");
    vi.stubEnv("APP_URL", "http://localhost:3000");

    expect(() => getAuthMode()).toThrow("Development authentication cannot run in production");
  });

  it("rejects local authentication for a hosted app URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("ALLOW_LOCAL_DEVELOPMENT_AUTH", "true");
    vi.stubEnv("APP_URL", "https://relay.example.com");

    expect(localDevelopmentAuthEnabled()).toBe(false);
    expect(() => getAuthMode()).toThrow("Development authentication cannot run in production");
  });

  it("keeps OIDC enabled for hosted production deployments", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "oidc");
    vi.stubEnv("ALLOW_LOCAL_DEVELOPMENT_AUTH", "false");
    vi.stubEnv("APP_URL", "https://relay.example.com");

    expect(getAuthMode()).toBe("oidc");
  });
});

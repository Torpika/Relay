import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/server/http/errors";
import { assertTrustedOrigin } from "@/server/security/origin";

describe("origin validation", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS;

  beforeEach(() => {
    process.env.APP_URL = "https://relay.example";
    process.env.AUTH_TRUSTED_ORIGINS = "https://admin.relay.example";
  });

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
    if (originalTrustedOrigins === undefined) {
      delete process.env.AUTH_TRUSTED_ORIGINS;
    } else {
      process.env.AUTH_TRUSTED_ORIGINS = originalTrustedOrigins;
    }
  });

  it("accepts same-origin writes", () => {
    const request = new Request("https://relay.example/api/agents", {
      method: "POST",
      headers: { Origin: "https://relay.example" }
    });

    expect(() => assertTrustedOrigin(request)).not.toThrow();
  });

  it("accepts explicitly trusted origins", () => {
    const request = new Request("https://relay.example/api/agents", {
      method: "POST",
      headers: { Origin: "https://admin.relay.example" }
    });

    expect(() => assertTrustedOrigin(request)).not.toThrow();
  });

  it("rejects missing and cross-site origins", () => {
    const missing = new Request("https://relay.example/api/agents", { method: "POST" });
    const crossSite = new Request("https://relay.example/api/agents", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }
    });

    expect(() => assertTrustedOrigin(missing)).toThrow(ApiError);
    expect(() => assertTrustedOrigin(crossSite)).toThrow(ApiError);
  });

  it("does not trust an unconfigured request host", () => {
    const request = new Request("https://attacker.example/api/agents", {
      method: "POST",
      headers: { Origin: "https://attacker.example" }
    });

    expect(() => assertTrustedOrigin(request)).toThrow(ApiError);
  });

  it("allows safe reads without an Origin header", () => {
    const request = new Request("https://relay.example/api/dashboard");
    expect(() => assertTrustedOrigin(request)).not.toThrow();
  });
});

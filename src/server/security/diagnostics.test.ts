import { describe, expect, it } from "vitest";
import { sanitizeDiagnostic } from "@/server/security/diagnostics";

describe("sanitizeDiagnostic", () => {
  it("keeps a useful failure while redacting credentials and local account paths", () => {
    expect(sanitizeDiagnostic(
      "Request failed for Bearer secret-token at /Users/alex/private/repo: API key=abc123"
    )).toBe("Request failed for Bearer [redacted] at ~/private/repo: API key=[redacted]");
  });

  it("bounds noisy runtime output", () => {
    expect(sanitizeDiagnostic("x".repeat(900))).toHaveLength(500);
  });

  it("redacts common sensitive values in lifecycle errors", () => {
    expect(sanitizeDiagnostic("token: abc123 password=letmein C:\\Users\\alex\\project"))
      .toBe("token: [redacted] password=[redacted] %USERPROFILE%\\project");
  });
});

import { describe, expect, it } from "vitest";
import { createProviderSchema } from "@/server/providers/schemas";

describe("createProviderSchema", () => {
  it("accepts an explicit custom local CLI configuration", () => {
    expect(createProviderSchema.parse({
      name: "Trusted local AI",
      kind: "local_custom",
      protocol: "local_cli",
      baseUrl: "local://custom",
      localCommand: "/usr/local/bin/example-ai",
      localArgs: ["--prompt", "{prompt}"]
    })).toMatchObject({ kind: "local_custom", localCommand: "/usr/local/bin/example-ai" });
  });

  it("rejects a custom local CLI that does not identify an absolute executable", () => {
    expect(() => createProviderSchema.parse({
      name: "Untrusted local AI",
      kind: "local_custom",
      protocol: "local_cli",
      baseUrl: "local://custom",
      localCommand: "example-ai"
    })).toThrow("absolute executable path");
  });
});

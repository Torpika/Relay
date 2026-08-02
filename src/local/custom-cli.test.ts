import { describe, expect, it } from "vitest";
import {
  createCustomLocalCliConfiguration,
  parseCustomLocalCliConfiguration,
  serializeCustomLocalCliConfiguration
} from "@/local/custom-cli";

describe("custom local CLI configuration", () => {
  it("round-trips an explicit executable and argument list", () => {
    const configuration = createCustomLocalCliConfiguration("/usr/local/bin/example-ai", ["--prompt", "{prompt}"]);

    expect(parseCustomLocalCliConfiguration(serializeCustomLocalCliConfiguration(configuration))).toEqual(configuration);
  });

  it("rejects commands that rely on PATH lookup", () => {
    expect(() => createCustomLocalCliConfiguration("example-ai", [])).toThrow("absolute executable path");
  });
});

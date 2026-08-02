import { describe, expect, it } from "vitest";
import { describeRunControl } from "@/lib/run-control";

describe("describeRunControl", () => {
  it("explains a graceful stop as a pending checkpoint", () => {
    expect(describeRunControl({ status: "stopping", desiredState: "stopped", stopMode: "graceful" })).toMatchObject({
      tone: "waiting",
      title: "Stopping after this round"
    });
  });

  it("distinguishes immediate cancellation from graceful stopping", () => {
    expect(describeRunControl({ status: "stopping", desiredState: "stopped", stopMode: "immediate" })).toMatchObject({
      tone: "attention",
      title: "Stopping immediately"
    });
  });

  it("explains a settled pause without implying that work is still running", () => {
    expect(describeRunControl({ status: "paused", desiredState: "paused", stopMode: null })).toMatchObject({
      tone: "paused",
      title: "Paused at a checkpoint"
    });
  });
});

import { describe, expect, it } from "vitest";
import { describeRunControl, describeRunEvent } from "@/lib/run-control";

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

  it("makes a guardrail pause distinguishable from an operator pause", () => {
    expect(describeRunControl(
      { id: "run", status: "paused", desiredState: "paused", stopMode: null },
      [{
        id: 1,
        type: "iteration.completed",
        runId: "run",
        iterationId: "round",
        payload: { number: 4, stopReason: "token_limit" },
        createdAt: "2026-08-02T00:00:00.000Z"
      }]
    )).toMatchObject({ tone: "paused", title: "Token ceiling reached" });
  });

  it("turns lifecycle events into specific operator-facing explanations", () => {
    expect(describeRunEvent({
      id: 1,
      type: "iteration.completed",
      runId: "run",
      iterationId: "round",
      payload: { number: 2, stopReason: "consensus" },
      createdAt: "2026-08-02T00:00:00.000Z"
    })).toBe("Round 2 reached peer-review consensus; Relay stopped the loop.");
  });
});

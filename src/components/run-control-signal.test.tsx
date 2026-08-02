import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunControlSignal } from "@/components/run-control-signal";

describe("RunControlSignal", () => {
  it("makes a graceful stop boundary explicit", () => {
    render(<RunControlSignal run={{
      id: "run",
      conversationId: "conversation",
      status: "stopping",
      desiredState: "stopped",
      phase: "reviewing",
      currentIteration: 2,
      synthesizerAgentId: "agent",
      reviewTopology: "all_to_all",
      maxIterations: null,
      maxTotalTokens: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      consecutiveFailures: 0,
      stopMode: "graceful",
      startedAt: null,
      stoppedAt: null
    }} />);

    expect(screen.getByRole("status", { name: "Run control state" })).toHaveTextContent("Stopping after this round");
    expect(screen.getByRole("status", { name: "Run control state" })).toHaveTextContent("save the current checkpoint");
  });
});

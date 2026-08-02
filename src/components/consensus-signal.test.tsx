import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsensusSignal } from "@/components/consensus-signal";
import type { ArtifactSummary } from "@/lib/contracts";

function review(content: string, status: ArtifactSummary["status"] = "complete"): ArtifactSummary {
  return {
    id: content,
    kind: "review",
    agentId: "reviewer",
    agentName: "Reviewer",
    targetAgentId: "author",
    targetAgentName: "Author",
    content,
    status,
    latencyMs: null,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    createdAt: "2026-08-02T00:00:00.000Z"
  };
}

describe("ConsensusSignal", () => {
  it("shows blockers before a loop can safely conclude", () => {
    render(<ConsensusSignal reviews={[
      review("RELAY_REVIEW_DECISION: APPROVE\nRELAY_BLOCKING_ISSUES: 0"),
      review("RELAY_REVIEW_DECISION: CHANGES_REQUESTED\nRELAY_BLOCKING_ISSUES: 3")
    ]} />);

    expect(screen.getByLabelText("Consensus signal")).toHaveTextContent("Changes requested");
    expect(screen.getByLabelText("Consensus signal")).toHaveTextContent("3 unresolved blockers remain.");
  });
});

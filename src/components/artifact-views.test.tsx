import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactSummary, IterationDetail } from "@/lib/contracts";
import { ArtifactView } from "@/components/artifact-views";

afterEach(cleanup);

function reviewArtifact(
  id: string,
  reviewer: string,
  author: string
): ArtifactSummary {
  return {
    id,
    kind: "review",
    agentId: `${reviewer}-id`,
    agentName: reviewer,
    targetAgentId: `${author}-id`,
    targetAgentName: author,
    content: `Review of **${author}**`,
    status: "complete",
    latencyMs: 850,
    inputTokens: 120,
    outputTokens: 80,
    createdAt: "2026-08-01T10:00:00.000Z"
  };
}

describe("ArtifactView reviews", () => {
  it("renders a semantic peer-review matrix and opens selected reviews", () => {
    const firstReview = reviewArtifact("review-1", "Codex", "Grok");
    const iteration: IterationDetail = {
      id: "iteration-1",
      number: 1,
      phase: "reviewing",
      status: "running",
      synthesis: null,
      artifacts: [firstReview, reviewArtifact("review-2", "Grok", "Codex")],
      startedAt: "2026-08-01T10:00:00.000Z",
      completedAt: null
    };
    const onSelectArtifact = vi.fn();

    render(
      <ArtifactView
        view="reviews"
        iteration={iteration}
        events={[]}
        selectedArtifactId={null}
        onSelectArtifact={onSelectArtifact}
      />
    );

    expect(screen.getByRole("table", { name: "Peer review coverage by reviewer and draft author" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Self-review not assigned")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Codex's review of Grok: complete" }));
    expect(onSelectArtifact).toHaveBeenCalledWith(firstReview);
  });
});

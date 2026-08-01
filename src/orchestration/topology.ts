import type { ExecutionAgent, ReviewTopology, StoredArtifact } from "@/orchestration/types";

export interface ReviewAssignment {
  reviewer: ExecutionAgent;
  draft: StoredArtifact;
}

export function buildReviewAssignments(
  agents: readonly ExecutionAgent[],
  drafts: readonly StoredArtifact[],
  topology: ReviewTopology,
  iterationNumber: number
): ReviewAssignment[] {
  const reviewers = agents
    .filter((agent) => agent.roles.includes("review"))
    .toSorted((left, right) => left.position - right.position);
  const orderedDrafts = drafts.toSorted((left, right) => {
    const leftPosition = agents.find((agent) => agent.id === left.agentId)?.position ?? 0;
    const rightPosition = agents.find((agent) => agent.id === right.agentId)?.position ?? 0;
    return leftPosition - rightPosition;
  });

  if (topology === "all_to_all") {
    return orderedDrafts.flatMap((draft) =>
      reviewers
        .filter((reviewer) => reviewer.id !== draft.agentId)
        .map((reviewer) => ({ reviewer, draft }))
    );
  }

  return orderedDrafts.flatMap((draft) => {
    const eligibleReviewers = reviewers.filter((reviewer) => reviewer.id !== draft.agentId);

    if (eligibleReviewers.length === 0) {
      return [];
    }

    const draftPosition = agents.find((agent) => agent.id === draft.agentId)?.position ?? 0;
    const firstFollowingIndex = eligibleReviewers.findIndex(
      (reviewer) => reviewer.position > draftPosition
    );
    const startingIndex = firstFollowingIndex === -1 ? 0 : firstFollowingIndex;
    const rotation = Math.max(0, iterationNumber - 1) % eligibleReviewers.length;
    const reviewer = eligibleReviewers[(startingIndex + rotation) % eligibleReviewers.length];
    return [{ reviewer, draft }];
  });
}

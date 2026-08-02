import type { ArtifactSummary } from "@/lib/contracts";

export type ReviewDecision = "approve" | "changes_requested" | "unknown";

export interface ReviewConsensusSummary {
  total: number;
  completed: number;
  approvals: number;
  changesRequested: number;
  blockingIssues: number;
  state: "pending" | "blocked" | "approved";
}

export function parseReviewDecision(content: string): { decision: ReviewDecision; blockingIssues: number | null } {
  const decision = /(?:^|\n)RELAY_REVIEW_DECISION:\s*(APPROVE|CHANGES_REQUESTED)\s*(?:\n|$)/iu.exec(content)?.[1];
  const blockingIssues = /(?:^|\n)RELAY_BLOCKING_ISSUES:\s*(\d+)\s*(?:\n|$)/iu.exec(content)?.[1];

  return {
    decision: decision === "APPROVE" ? "approve" : decision === "CHANGES_REQUESTED" ? "changes_requested" : "unknown",
    blockingIssues: blockingIssues === undefined ? null : Number(blockingIssues)
  };
}

export function summarizeReviewConsensus(
  reviews: readonly Pick<ArtifactSummary, "content" | "status">[]
): ReviewConsensusSummary {
  const completedReviews = reviews.filter((review) => review.status === "complete");
  const signals = completedReviews.map((review) => parseReviewDecision(review.content));
  const approvals = signals.filter((signal) => signal.decision === "approve" && signal.blockingIssues === 0).length;
  const changesRequested = signals.filter(
    (signal) => signal.decision === "changes_requested" || (signal.blockingIssues !== null && signal.blockingIssues > 0)
  ).length;
  const blockingIssues = signals.reduce((total, signal) => total + (signal.blockingIssues ?? 0), 0);
  const hasConsensus = reviews.length >= 2 && completedReviews.length === reviews.length && approvals === reviews.length;

  return {
    total: reviews.length,
    completed: completedReviews.length,
    approvals,
    changesRequested,
    blockingIssues,
    state: hasConsensus ? "approved" : changesRequested > 0 ? "blocked" : "pending"
  };
}

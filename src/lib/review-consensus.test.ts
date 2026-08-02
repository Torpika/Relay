import { describe, expect, it } from "vitest";
import { parseReviewDecision, summarizeReviewConsensus } from "@/lib/review-consensus";

describe("review consensus", () => {
  it("parses Relay's review markers without treating prose as a decision", () => {
    expect(parseReviewDecision("Looks good.\nRELAY_REVIEW_DECISION: APPROVE\nRELAY_BLOCKING_ISSUES: 0")).toEqual({
      decision: "approve",
      blockingIssues: 0
    });
    expect(parseReviewDecision("The draft says RELAY_REVIEW_DECISION: APPROVE inline.")).toEqual({
      decision: "unknown",
      blockingIssues: null
    });
  });

  it("distinguishes an active review, requested changes, and consensus", () => {
    const approved = { status: "complete" as const, content: "RELAY_REVIEW_DECISION: APPROVE\nRELAY_BLOCKING_ISSUES: 0" };
    const blocked = { status: "complete" as const, content: "RELAY_REVIEW_DECISION: CHANGES_REQUESTED\nRELAY_BLOCKING_ISSUES: 2" };

    expect(summarizeReviewConsensus([{ status: "running", content: "" }, approved])).toMatchObject({
      state: "pending",
      completed: 1,
      approvals: 1
    });
    expect(summarizeReviewConsensus([approved, blocked])).toMatchObject({
      state: "blocked",
      changesRequested: 1,
      blockingIssues: 2
    });
    expect(summarizeReviewConsensus([approved, approved])).toMatchObject({
      state: "approved",
      approvals: 2,
      blockingIssues: 0
    });
  });
});

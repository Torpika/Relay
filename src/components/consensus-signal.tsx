import { BadgeCheck, CircleAlert, LoaderCircle } from "lucide-react";
import type { ArtifactSummary } from "@/lib/contracts";
import { summarizeReviewConsensus } from "@/lib/review-consensus";

export function ConsensusSignal({ reviews }: { reviews: ArtifactSummary[] }) {
  const summary = summarizeReviewConsensus(reviews);
  const copy = consensusCopy(summary);
  const Icon = summary.state === "approved" ? BadgeCheck : summary.state === "blocked" ? CircleAlert : LoaderCircle;

  return (
    <section className={`consensus-signal consensus-signal--${summary.state}`} aria-label="Consensus signal">
      <span className="consensus-signal__icon"><Icon className={summary.state === "pending" ? "spin" : ""} size={17} /></span>
      <div className="consensus-signal__copy">
        <p className="eyebrow">Consensus signal</p>
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </div>
      <dl className="consensus-signal__facts">
        <div><dt>Reviews</dt><dd>{summary.completed}/{summary.total}</dd></div>
        <div><dt>Approved</dt><dd>{summary.approvals}</dd></div>
        <div><dt>Blockers</dt><dd>{summary.blockingIssues}</dd></div>
      </dl>
    </section>
  );
}

function consensusCopy(summary: ReturnType<typeof summarizeReviewConsensus>): { title: string; detail: string } {
  if (summary.state === "approved") {
    return { title: "Consensus reached", detail: "Every completed peer review approved with zero blockers." };
  }

  if (summary.state === "blocked") {
    return {
      title: "Changes requested",
      detail: `${summary.blockingIssues} unresolved ${summary.blockingIssues === 1 ? "blocker remains" : "blockers remain"}.`
    };
  }

  return {
    title: "Awaiting peer review",
    detail: summary.total ? "Relay will continue when the review set is complete." : "Reviews appear after the team finishes its drafts."
  };
}

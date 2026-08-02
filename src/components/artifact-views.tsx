"use client";

import {
  Activity,
  ArrowRight,
  Blend,
  Bot,
  CheckCircle2,
  Clock3,
  Files,
  LoaderCircle,
  MessageSquareText,
  Radio,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import type { ArtifactSummary, DomainEvent, IterationDetail, RunPhase } from "@/lib/contracts";
import {
  formatCompactNumber,
  formatDuration,
  formatPhase,
  formatRelativeTime,
  initials
} from "@/components/formatters";
import { SafeMarkdown } from "@/components/safe-markdown";
import { ConsensusSignal } from "@/components/consensus-signal";
import { describeRunEvent } from "@/lib/run-control";

export type WorkspaceView = "drafts" | "reviews" | "synthesis" | "activity";

export const workspaceViews: Array<{
  id: WorkspaceView;
  label: string;
  icon: typeof Files;
}> = [
  { id: "drafts", label: "Drafts", icon: Files },
  { id: "reviews", label: "Reviews", icon: MessageSquareText },
  { id: "synthesis", label: "Synthesis", icon: Blend },
  { id: "activity", label: "Activity", icon: Activity }
];

function artifactStatusIcon(status: ArtifactSummary["status"]) {
  if (status === "complete") {
    return <CheckCircle2 size={14} />;
  }

  if (status === "running" || status === "pending") {
    return <LoaderCircle className={status === "running" ? "spin" : ""} size={14} />;
  }

  return <TriangleAlert size={14} />;
}

function ArtifactCard({
  artifact,
  selected,
  onSelect,
  review = false
}: {
  artifact: ArtifactSummary;
  selected: boolean;
  onSelect: () => void;
  review?: boolean;
}) {
  return (
    <article className={`artifact-card ${selected ? "is-selected" : ""}`}>
      <button className="artifact-card__hit-area" aria-label={`Inspect ${artifact.agentName}'s ${artifact.kind}`} onClick={onSelect} />
      <header className="artifact-card__header">
        <span className="agent-avatar agent-avatar--small">{initials(artifact.agentName)}</span>
        <span className="artifact-card__agent">
          <strong>{artifact.agentName}</strong>
          {review ? (
            <small>reviewing {artifact.targetAgentName ?? "peer output"}</small>
          ) : (
            <small>{artifact.status === "complete" ? "Independent draft" : "Generating draft"}</small>
          )}
        </span>
        <span className={`artifact-state artifact-state--${artifact.status}`}>
          {artifactStatusIcon(artifact.status)} {artifact.status}
        </span>
      </header>
      {review && artifact.targetAgentName ? (
        <div className="review-route" aria-label={`${artifact.agentName} reviewed ${artifact.targetAgentName}`}>
          <span>{artifact.agentName}</span><ArrowRight size={13} /><span>{artifact.targetAgentName}</span>
        </div>
      ) : null}
      <div className="artifact-card__content">
        {artifact.content ? (
          <SafeMarkdown content={artifact.content} compact />
        ) : (
          <GeneratingPlaceholder label={artifact.status === "failed" ? "Generation failed" : "Waiting for output"} />
        )}
      </div>
      <footer className="artifact-card__footer">
        <span><Clock3 size={12} /> {formatDuration(artifact.latencyMs)}</span>
        <span>{formatCompactNumber(artifact.inputTokens + artifact.outputTokens)} tokens</span>
        <span>{formatRelativeTime(artifact.createdAt)}</span>
      </footer>
    </article>
  );
}

function GeneratingPlaceholder({ label }: { label: string }) {
  return (
    <div className="generating-placeholder">
      <span /><span /><span />
      <p>{label}</p>
    </div>
  );
}

function EmptyView({
  icon: Icon,
  title,
  description,
  active = false
}: {
  icon: typeof Files;
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div className="view-empty">
      <span className={active ? "is-active" : ""}><Icon size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {active ? <div className="view-empty__progress"><span /></div> : null}
    </div>
  );
}

function DraftsView({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  phase
}: {
  artifacts: ArtifactSummary[];
  selectedArtifactId: string | null;
  onSelectArtifact: (artifact: ArtifactSummary) => void;
  phase: RunPhase;
}) {
  if (!artifacts.length) {
    const active = phase === "preparing" || phase === "drafting";
    return (
      <EmptyView
        icon={Sparkles}
        title={active ? "Drafts are being prepared" : "No drafts in this round"}
        description={active ? "Each agent is working independently. Results appear as they arrive." : "Start a run to collect independent approaches from your agents."}
        active={active}
      />
    );
  }

  return (
    <div className="artifact-grid">
      {artifacts.map((artifact) => (
        <ArtifactCard
          artifact={artifact}
          key={artifact.id}
          selected={selectedArtifactId === artifact.id}
          onSelect={() => onSelectArtifact(artifact)}
        />
      ))}
    </div>
  );
}

function ReviewsView({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  phase
}: {
  artifacts: ArtifactSummary[];
  selectedArtifactId: string | null;
  onSelectArtifact: (artifact: ArtifactSummary) => void;
  phase: RunPhase;
}) {
  if (!artifacts.length) {
    const active = phase === "reviewing";
    return (
      <EmptyView
        icon={MessageSquareText}
        title={active ? "Peer review is in progress" : "Reviews arrive after drafts"}
        description={active ? "Agents are testing assumptions and identifying gaps across peer drafts." : "Relay begins review once every available draft has reached a checkpoint."}
        active={active}
      />
    );
  }

  const agentNames = Array.from(
    new Set(artifacts.flatMap((artifact) => [artifact.agentName, artifact.targetAgentName].filter((name): name is string => Boolean(name))))
  );

  return (
    <>
      <ConsensusSignal reviews={artifacts} />
      <div className="review-matrix-wrap">
        <div className="review-matrix__legend"><span>Reviewer</span><span>Draft author</span></div>
        <table className="review-matrix">
          <caption className="sr-only">Peer review coverage by reviewer and draft author</caption>
          <thead>
            <tr>
              <th scope="col">Reviewer</th>
              {agentNames.map((agentName) => <th scope="col" key={agentName}>{agentName}</th>)}
            </tr>
          </thead>
          <tbody>
            {agentNames.map((reviewerName) => (
              <tr key={reviewerName}>
                <th scope="row"><span className="agent-avatar agent-avatar--small">{initials(reviewerName)}</span><span>{reviewerName}</span></th>
                {agentNames.map((authorName) => {
                  const artifact = artifacts.find(
                    (candidate) => candidate.agentName === reviewerName && candidate.targetAgentName === authorName
                  );

                  if (reviewerName === authorName) {
                    return <td className="review-matrix__self" key={authorName}><span aria-label="Self-review not assigned">—</span></td>;
                  }

                  return (
                    <td key={authorName}>
                      {artifact ? (
                        <button
                          className={`${selectedArtifactId === artifact.id ? "is-selected" : ""} is-${artifact.status}`}
                          onClick={() => onSelectArtifact(artifact)}
                          aria-label={`${reviewerName}'s review of ${authorName}: ${artifact.status}`}
                        >
                          {artifactStatusIcon(artifact.status)}
                          <span>{artifact.status}</span>
                        </button>
                      ) : (
                        <span className="review-matrix__unassigned" aria-label="Review not assigned">·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="review-matrix__hint">Select a completed review to inspect its reasoning and token usage.</p>
      </div>
      <div className="review-list review-list--mobile">
        {artifacts.map((artifact) => (
          <ArtifactCard
            artifact={artifact}
            key={artifact.id}
            selected={selectedArtifactId === artifact.id}
            onSelect={() => onSelectArtifact(artifact)}
            review
          />
        ))}
      </div>
    </>
  );
}

function SynthesisView({
  iteration,
  selectedArtifactId,
  onSelectArtifact
}: {
  iteration: IterationDetail;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifact: ArtifactSummary) => void;
}) {
  const synthesisArtifact = iteration.artifacts.find((artifact) => artifact.kind === "synthesis");
  const content = iteration.synthesis ?? synthesisArtifact?.content;

  if (!content) {
    const active = iteration.phase === "synthesizing" || synthesisArtifact?.status === "running";
    return (
      <EmptyView
        icon={Blend}
        title={active ? "Consensus is taking shape" : "No synthesis yet"}
        description={active ? "The synthesizer is reconciling drafts and reviews into one result." : "A consolidated result appears here after peer review."}
        active={active}
      />
    );
  }

  return (
    <article className={`synthesis-document ${selectedArtifactId === synthesisArtifact?.id ? "is-selected" : ""}`}>
      <header className="synthesis-document__header">
        <span><Blend size={17} /></span>
        <div><p className="eyebrow">Round {iteration.number} consensus</p><h2>Synthesized result</h2></div>
        {synthesisArtifact ? (
          <button onClick={() => onSelectArtifact(synthesisArtifact)}>Inspect details</button>
        ) : null}
      </header>
      <SafeMarkdown content={content} />
      <footer>
        <span><CheckCircle2 size={14} /> Checkpoint saved</span>
        {synthesisArtifact ? <span>{formatCompactNumber(synthesisArtifact.inputTokens + synthesisArtifact.outputTokens)} tokens</span> : null}
      </footer>
    </article>
  );
}

function eventLabel(event: DomainEvent): string {
  return event.type
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function eventSummary(event: DomainEvent): string {
  const lifecycleSummary = describeRunEvent(event);

  if (lifecycleSummary) {
    return lifecycleSummary;
  }

  const values = ["message", "agentName", "phase", "status"]
    .map((key) => event.payload[key])
    .filter((value): value is string => typeof value === "string");

  return values.join(" · ") || "Run state updated";
}

function ActivityView({ events, iterations }: { events: DomainEvent[]; iterations: IterationDetail[] }) {
  const timeline = events.length
    ? events
    : iterations.flatMap((iteration, index) => [
        {
          id: -(index + 1),
          type: `round.${iteration.status}`,
          runId: null,
          iterationId: iteration.id,
          payload: { message: `Round ${iteration.number} · ${formatPhase(iteration.phase)}` },
          createdAt: iteration.completedAt ?? iteration.startedAt ?? new Date().toISOString()
        } satisfies DomainEvent
      ]);

  if (!timeline.length) {
    return <EmptyView icon={Activity} title="Activity will appear here" description="Run events stream into this timeline as agents begin working." />;
  }

  return (
    <ol className="activity-timeline">
      {timeline.map((event, index) => (
        <li key={event.id} className={index === 0 ? "is-latest" : ""}>
          <span className="activity-timeline__marker">{index === 0 ? <Radio size={13} /> : <span />}</span>
          <div>
            <strong>{eventLabel(event)}</strong>
            <p>{eventSummary(event)}</p>
          </div>
          <time dateTime={event.createdAt}>{formatRelativeTime(event.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}

export function ArtifactView({
  view,
  iteration,
  events,
  selectedArtifactId,
  onSelectArtifact
}: {
  view: WorkspaceView;
  iteration: IterationDetail;
  events: DomainEvent[];
  selectedArtifactId: string | null;
  onSelectArtifact: (artifact: ArtifactSummary) => void;
}) {
  const drafts = iteration.artifacts.filter((artifact) => artifact.kind === "draft");
  const reviews = iteration.artifacts.filter((artifact) => artifact.kind === "review");

  if (view === "drafts") {
    return <DraftsView artifacts={drafts} selectedArtifactId={selectedArtifactId} onSelectArtifact={onSelectArtifact} phase={iteration.phase} />;
  }

  if (view === "reviews") {
    return <ReviewsView artifacts={reviews} selectedArtifactId={selectedArtifactId} onSelectArtifact={onSelectArtifact} phase={iteration.phase} />;
  }

  if (view === "synthesis") {
    return <SynthesisView iteration={iteration} selectedArtifactId={selectedArtifactId} onSelectArtifact={onSelectArtifact} />;
  }

  return <ActivityView events={events} iterations={[iteration]} />;
}

export function ConversationWaitingView({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  return (
    <div className="conversation-waiting">
      <span className="conversation-waiting__visual"><Bot size={30} /><span /><span /></span>
      <p className="eyebrow">Team assembled</p>
      <h2>Ready for round one</h2>
      <p>Start the run when you are ready. Agents will draft, review, synthesize, and continue until a guardrail or operator stops them.</p>
      <button className="waiting-start" onClick={onStart} disabled={disabled}><Sparkles size={17} /> Start run</button>
    </div>
  );
}

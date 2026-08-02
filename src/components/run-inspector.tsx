"use client";

import {
  Check,
  CheckCheck,
  ChevronLeft,
  Coins,
  Copy,
  Infinity as InfinityIcon,
  Network,
  ShieldAlert,
  X
} from "lucide-react";
import { useState } from "react";
import type {
  ArtifactSummary,
  ConversationDetail,
  ProviderConnectionSummary
} from "@/lib/contracts";
import {
  formatCompactNumber,
  formatDuration,
  initials,
  safeAgentColor
} from "@/components/formatters";
import { SafeMarkdown } from "@/components/safe-markdown";
import { ConsensusSignal } from "@/components/consensus-signal";
import { IconButton } from "@/components/ui";

interface RunInspectorProps {
  conversation: ConversationDetail;
  connections: ProviderConnectionSummary[];
  selectedArtifact: ArtifactSummary | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onClearArtifact: () => void;
}

export function RunInspector({
  conversation,
  connections,
  selectedArtifact,
  mobileOpen,
  onCloseMobile,
  onClearArtifact
}: RunInspectorProps) {
  const [copied, setCopied] = useState(false);
  const run = conversation.run;
  const totalTokens = (run?.totalInputTokens ?? 0) + (run?.totalOutputTokens ?? 0);
  const tokenLimit = run?.maxTotalTokens ?? null;
  const tokenProgress = tokenLimit ? Math.min(100, (totalTokens / tokenLimit) * 100) : 0;
  const synthesizer = conversation.agents.find((agent) => agent.id === run?.synthesizerAgentId);
  const latestReviews = conversation.iterations.at(-1)?.artifacts.filter((artifact) => artifact.kind === "review") ?? [];

  const copyArtifact = async () => {
    if (!selectedArtifact) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedArtifact.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      {mobileOpen ? <button className="drawer-backdrop drawer-backdrop--inspector" aria-label="Dismiss run inspector" onClick={onCloseMobile} /> : null}
      <aside className={`run-inspector ${mobileOpen ? "is-open" : ""}`} aria-label="Run inspector">
        <header className="run-inspector__header">
          <div>
            <p className="eyebrow">Inspector</p>
            <h2>{selectedArtifact ? "Artifact details" : "Run overview"}</h2>
          </div>
          <IconButton label="Close run inspector" icon={<X size={18} />} onClick={onCloseMobile} />
        </header>

        <div className="run-inspector__scroll">
          {selectedArtifact ? (
            <section className="artifact-inspector">
              <button className="inspector-back" onClick={onClearArtifact}><ChevronLeft size={14} /> Run overview</button>
              <div className="artifact-inspector__agent">
                <span className="agent-avatar">{initials(selectedArtifact.agentName)}</span>
                <div><strong>{selectedArtifact.agentName}</strong><small>{selectedArtifact.kind}</small></div>
                <span className={`artifact-state artifact-state--${selectedArtifact.status}`}>{selectedArtifact.status}</span>
              </div>
              {selectedArtifact.targetAgentName ? (
                <dl className="inspector-facts">
                  <div><dt>Reviewed agent</dt><dd>{selectedArtifact.targetAgentName}</dd></div>
                </dl>
              ) : null}
              <div className="inspector-section-title">
                <h3>Output</h3>
                <button onClick={copyArtifact}>{copied ? <CheckCheck size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
              </div>
              <div className="artifact-inspector__content">
                {selectedArtifact.content ? <SafeMarkdown content={selectedArtifact.content} compact /> : <p>No output was recorded.</p>}
              </div>
              <dl className="inspector-facts inspector-facts--grid">
                <div><dt>Latency</dt><dd>{formatDuration(selectedArtifact.latencyMs)}</dd></div>
                <div><dt>Input</dt><dd>{formatCompactNumber(selectedArtifact.inputTokens)} tok</dd></div>
                <div><dt>Output</dt><dd>{formatCompactNumber(selectedArtifact.outputTokens)} tok</dd></div>
                <div><dt>Status</dt><dd>{selectedArtifact.status}</dd></div>
              </dl>
            </section>
          ) : (
            <>
              <section className="inspector-section">
                <div className="inspector-section-title"><h3>Loop</h3><span className={run?.desiredState === "running" ? "live-label" : "neutral-label"}>{run?.desiredState ?? "ready"}</span></div>
                <div className="loop-stat">
                  <span><Network size={17} /></span>
                  <div><small>Current round</small><strong>{run?.currentIteration ?? 0}</strong></div>
                  <div><small>Round limit</small><strong>{run?.maxIterations ?? <InfinityIcon aria-label="Unlimited" size={19} />}</strong></div>
                </div>
                <dl className="inspector-facts">
                  <div><dt>Review topology</dt><dd>{run?.reviewTopology === "round_robin" ? "Round robin" : "All-to-all"}</dd></div>
                  <div><dt>Synthesizer</dt><dd>{synthesizer?.name ?? "—"}</dd></div>
                  <div><dt>Failure streak</dt><dd className={(run?.consecutiveFailures ?? 0) > 0 ? "danger-text" : ""}>{run?.consecutiveFailures ?? 0}</dd></div>
                </dl>
              </section>

              <ConsensusSignal reviews={latestReviews} />

              <section className="inspector-section">
                <div className="inspector-section-title"><h3>Usage</h3><span><Coins size={14} /> tokens</span></div>
                <div className="usage-total"><strong>{formatCompactNumber(totalTokens)}</strong><span>{tokenLimit ? `of ${formatCompactNumber(tokenLimit)}` : "no ceiling"}</span></div>
                <div className="usage-bar" aria-label={tokenLimit ? `${Math.round(tokenProgress)}% of token ceiling used` : "No token ceiling"}>
                  <span style={{ width: tokenLimit ? `${tokenProgress}%` : "0%" }} />
                </div>
                <div className="usage-split">
                  <span><i /> Input <strong>{formatCompactNumber(run?.totalInputTokens ?? 0)}</strong></span>
                  <span><i /> Output <strong>{formatCompactNumber(run?.totalOutputTokens ?? 0)}</strong></span>
                </div>
              </section>

              <section className="inspector-section">
                <div className="inspector-section-title"><h3>Agent team</h3><span>{conversation.agents.length}</span></div>
                <div className="inspector-agents">
                  {conversation.agents.map((agent) => {
                    const connection = connections.find((candidate) => candidate.id === agent.connectionId);
                    const color = safeAgentColor(agent.color);

                    return (
                      <div className="inspector-agent" key={agent.id}>
                        <span className="agent-avatar" style={{ "--agent-color": color } as React.CSSProperties}>{initials(agent.name)}</span>
                        <div><strong>{agent.name}</strong><small>{agent.model} · {agent.parameters.reasoningEffort ?? "default"} thinking</small></div>
                        <span className={`agent-health agent-health--${connection?.status ?? "untested"}`} title={connection?.status ?? "Unknown connection"} />
                        <p>{agent.roles.join(" · ")}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="inspector-section inspector-section--health">
                <div className="inspector-section-title"><h3>Safeguards</h3><ShieldAlert size={15} /></div>
                <ul className="safeguard-list">
                  <li><Check size={13} /> Operator pause and stop enabled</li>
                  <li><Check size={13} /> Provider credentials encrypted</li>
                  <li><Check size={13} /> Round checkpoints retained</li>
                </ul>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

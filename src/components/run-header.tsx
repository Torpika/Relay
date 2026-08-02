"use client";

import {
  Activity,
  Menu,
  PanelRightOpen,
  Pause,
  Play,
  Radio,
  Square,
  Zap
} from "lucide-react";
import type { ConversationDetail } from "@/lib/contracts";
import { PhaseStepper } from "@/components/phase-stepper";
import { RunControlSignal } from "@/components/run-control-signal";
import { Button, IconButton, StatusBadge } from "@/components/ui";

interface RunHeaderProps {
  conversation: ConversationDetail;
  canOperate: boolean;
  streamConnected: boolean;
  commandPending: "start" | "pause" | "resume" | null;
  onOpenSessions: () => void;
  onOpenInspector: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function RunHeader({
  conversation,
  canOperate,
  streamConnected,
  commandPending,
  onOpenSessions,
  onOpenInspector,
  onStart,
  onPause,
  onResume,
  onStop
}: RunHeaderProps) {
  const run = conversation.run;
  const status = run?.status ?? conversation.status;
  const canPause = run && ["starting", "running", "resuming"].includes(run.status);
  const canResume = run && ["paused", "pausing"].includes(run.status);
  const canStop = run && !["stopped", "stopping", "failed"].includes(run.status);

  return (
    <header className="run-header">
      <div className="run-header__topline">
        <IconButton className="mobile-only" label="Open sessions" icon={<Menu size={19} />} onClick={onOpenSessions} />
        <div className="run-title">
          <div className="run-title__meta">
            <StatusBadge status={status} />
            {run ? <span>Round {run.currentIteration || 1}</span> : <span>Not started</span>}
            {run && !streamConnected && ["running", "starting"].includes(run.status) ? (
              <span className="stream-state stream-state--reconnecting"><Activity size={12} /> Reconnecting</span>
            ) : run && streamConnected ? (
              <span className="stream-state"><Radio size={12} /> Live</span>
            ) : null}
          </div>
          <h1>{conversation.title}</h1>
          <p>{conversation.objective}</p>
        </div>

        <div className="run-controls" aria-label="Run controls">
          {!run || ["created", "stopped", "failed"].includes(run.status) ? (
            <Button
              variant="primary"
              icon={<Zap size={16} />}
              loading={commandPending === "start"}
              onClick={onStart}
              disabled={!canOperate}
              title={canOperate ? undefined : "Viewer access is read-only"}
            >
              Start run
            </Button>
          ) : null}
          {canPause ? (
            <Button
              icon={<Pause size={16} />}
              loading={commandPending === "pause"}
              onClick={onPause}
              disabled={!canOperate}
              title={canOperate ? undefined : "Viewer access is read-only"}
            >
              <span className="control-label">Pause</span>
            </Button>
          ) : null}
          {canResume ? (
            <Button
              variant="primary"
              icon={<Play size={16} />}
              loading={commandPending === "resume"}
              onClick={onResume}
              disabled={!canOperate}
              title={canOperate ? undefined : "Viewer access is read-only"}
            >
              <span className="control-label">Resume</span>
            </Button>
          ) : null}
          {canStop ? (
            <Button variant="danger" icon={<Square size={14} fill="currentColor" />} onClick={onStop} disabled={!canOperate} title={canOperate ? undefined : "Viewer access is read-only"}>
              <span className="control-label">Stop</span>
            </Button>
          ) : null}
          <IconButton className="inspector-toggle" label="Open run inspector" icon={<PanelRightOpen size={19} />} onClick={onOpenInspector} />
        </div>
      </div>
      {run ? <>
        <PhaseStepper phase={run.phase} status={run.status} />
        <RunControlSignal run={run} />
      </> : null}
    </header>
  );
}

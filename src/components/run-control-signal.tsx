import { CircleAlert, CirclePause, CircleStop, LoaderCircle, PlayCircle } from "lucide-react";
import type { RunDetail } from "@/lib/contracts";
import { describeRunControl } from "@/lib/run-control";

export function RunControlSignal({ run }: { run: RunDetail }) {
  const signal = describeRunControl(run);
  const Icon = signal.tone === "active"
    ? PlayCircle
    : signal.tone === "paused"
      ? CirclePause
      : signal.tone === "stopped"
        ? CircleStop
        : signal.tone === "attention"
          ? CircleAlert
          : LoaderCircle;

  return (
    <div className={`run-control-signal run-control-signal--${signal.tone}`} role="status" aria-label="Run control state">
      <Icon className={signal.tone === "waiting" ? "spin" : ""} size={14} />
      <span><strong>{signal.title}</strong><small>{signal.detail}</small></span>
    </div>
  );
}

import type { RunDetail } from "@/lib/contracts";

export type RunControlSignalTone = "active" | "waiting" | "paused" | "stopped" | "attention";

export interface RunControlSignalCopy {
  tone: RunControlSignalTone;
  title: string;
  detail: string;
}

export function describeRunControl(run: Pick<RunDetail, "status" | "desiredState" | "stopMode">): RunControlSignalCopy {
  if (run.status === "failed" || run.status === "needs_attention") {
    return {
      tone: "attention",
      title: run.status === "failed" ? "Run failed" : "Needs attention",
      detail: "Review the latest artifacts and activity before resuming the loop."
    };
  }

  if (run.status === "stopped") {
    return {
      tone: "stopped",
      title: "Run stopped",
      detail: "The latest completed checkpoint remains available to inspect or restart."
    };
  }

  if (run.desiredState === "stopped") {
    if (run.stopMode === "immediate") {
      return {
        tone: "attention",
        title: "Stopping immediately",
        detail: "Relay is cancelling in-flight work. Partial artifacts may be retained."
      };
    }

    return {
      tone: "waiting",
      title: "Stopping after this round",
      detail: "Relay will save the current checkpoint, then stop the loop."
    };
  }

  if (run.desiredState === "paused") {
    return run.status === "paused"
      ? {
          tone: "paused",
          title: "Paused at a checkpoint",
          detail: "No new work will start until you resume the loop."
        }
      : {
          tone: "waiting",
          title: "Pausing after this round",
          detail: "Relay will checkpoint active work before entering a safe pause."
        };
  }

  if (run.status === "starting" || run.status === "resuming") {
    return {
      tone: "waiting",
      title: run.status === "starting" ? "Preparing the loop" : "Resuming the loop",
      detail: "Relay is restoring the team and scheduling the next round."
    };
  }

  return {
    tone: "active",
    title: "Loop active",
    detail: "Rounds continue until consensus, a guardrail, or your stop request."
  };
}

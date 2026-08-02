import type { DomainEvent, RunDetail } from "@/lib/contracts";

export type RunControlSignalTone = "active" | "waiting" | "paused" | "stopped" | "attention";

export interface RunControlSignalCopy {
  tone: RunControlSignalTone;
  title: string;
  detail: string;
}

type StopReason = "graceful_stop" | "paused" | "consensus" | "iteration_limit" | "token_limit";

function stopReasonFromEvent(event: DomainEvent | undefined): StopReason | null {
  const stopReason = event?.payload.stopReason;
  return stopReason === "graceful_stop" || stopReason === "paused" || stopReason === "consensus" || stopReason === "iteration_limit" || stopReason === "token_limit"
    ? stopReason
    : null;
}

function latestEvent(events: DomainEvent[], runId: string | undefined, type: string): DomainEvent | undefined {
  return events.find((event) => event.type === type && (!runId || event.runId === runId));
}

export function describeRunControl(
  run: Pick<RunDetail, "status" | "desiredState" | "stopMode"> & Partial<Pick<RunDetail, "id">>,
  events: DomainEvent[] = []
): RunControlSignalCopy {
  if (run.status === "failed" || run.status === "needs_attention") {
    const failure = latestEvent(events, run.id, "job.failed")?.payload.error;

    return {
      tone: "attention",
      title: run.status === "failed" ? "Run failed" : "Needs attention",
      detail: typeof failure === "string"
        ? `Latest attempt failed: ${failure}`
        : "Review the latest artifacts and activity before resuming the loop."
    };
  }

  if (run.status === "stopped") {
    const cancellation = latestEvent(events, run.id, "iteration.cancelled");
    const stopReason = stopReasonFromEvent(latestEvent(events, run.id, "iteration.completed"));

    if (cancellation) {
      return {
        tone: "stopped",
        title: "Run stopped immediately",
        detail: "In-flight work was cancelled. Completed artifacts remain available to inspect."
      };
    }

    if (stopReason === "consensus") {
      return {
        tone: "stopped",
        title: "Consensus reached",
        detail: "Every completed peer review approved with zero blockers, so Relay concluded the loop."
      };
    }

    if (stopReason === "graceful_stop") {
      return {
        tone: "stopped",
        title: "Stopped after checkpoint",
        detail: "Relay completed the active round and saved its final checkpoint before stopping."
      };
    }

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
    const stopReason = stopReasonFromEvent(latestEvent(events, run.id, "iteration.completed"));

    if (run.status === "paused" && stopReason === "iteration_limit") {
      return {
        tone: "paused",
        title: "Round limit reached",
        detail: "Relay saved the final allowed checkpoint. Resume to continue beyond this guardrail."
      };
    }

    if (run.status === "paused" && stopReason === "token_limit") {
      return {
        tone: "paused",
        title: "Token ceiling reached",
        detail: "Relay paused before starting another round. Resume after increasing the budget."
      };
    }

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

export function describeRunEvent(event: DomainEvent): string | null {
  if (event.type === "iteration.completed") {
    const stopReason = stopReasonFromEvent(event);
    const round = typeof event.payload.number === "number" ? `Round ${event.payload.number}` : "Round";

    if (stopReason === "consensus") {
      return `${round} reached peer-review consensus; Relay stopped the loop.`;
    }

    if (stopReason === "graceful_stop") {
      return `${round} checkpoint saved; the requested graceful stop is complete.`;
    }

    if (stopReason === "paused") {
      return `${round} checkpoint saved; Relay is paused.`;
    }

    if (stopReason === "iteration_limit") {
      return `${round} checkpoint saved; the round limit was reached.`;
    }

    if (stopReason === "token_limit") {
      return `${round} checkpoint saved; the token ceiling was reached.`;
    }

    return `${round} checkpoint saved; the next round was scheduled.`;
  }

  if (event.type === "iteration.cancelled") {
    return "In-flight work was cancelled by an immediate stop request.";
  }

  if (event.type === "job.failed" && typeof event.payload.error === "string") {
    return `The latest job failed: ${event.payload.error}`;
  }

  if (event.type === "artifact.failed" && typeof event.payload.message === "string") {
    return `An agent artifact failed: ${event.payload.message}`;
  }

  if (event.type === "run.control_requested" && typeof event.payload.command === "string") {
    return `Operator requested ${event.payload.command}.`;
  }

  return null;
}

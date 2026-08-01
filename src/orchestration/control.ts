import type { ClaimedRunJob, OrchestrationRepository, RunControl } from "@/orchestration/types";

export type RunAbortReason = "immediate_stop" | "stale_epoch" | "run_missing" | "worker_shutdown";

export class RunAbortedError extends Error {
  readonly reason: RunAbortReason;

  constructor(reason: RunAbortReason) {
    super(`Run execution aborted: ${reason}`);
    this.name = "RunAbortedError";
    this.reason = reason;
  }
}

export class RunControlFence {
  readonly #repository: OrchestrationRepository;
  readonly #job: ClaimedRunJob;
  readonly #abortController = new AbortController();
  readonly #pollIntervalMs: number;
  #controlVersion: number;
  #finishAfterRound: "graceful_stop" | "paused" | null = null;
  #pollTimeout: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;

  constructor(
    repository: OrchestrationRepository,
    job: ClaimedRunJob,
    initialControl: RunControl,
    pollIntervalMs: number
  ) {
    this.#repository = repository;
    this.#job = job;
    this.#controlVersion = initialControl.controlVersion;
    this.#pollIntervalMs = pollIntervalMs;
    this.applyControl(initialControl);
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get controlVersion(): number {
    return this.#controlVersion;
  }

  get finishAfterRound(): "graceful_stop" | "paused" | null {
    return this.#finishAfterRound;
  }

  start(): void {
    if (this.#stopped || this.#pollTimeout) {
      return;
    }

    this.#pollTimeout = setTimeout(() => void this.poll(), this.#pollIntervalMs);
  }

  stop(): void {
    this.#stopped = true;

    if (this.#pollTimeout) {
      clearTimeout(this.#pollTimeout);
      this.#pollTimeout = null;
    }
  }

  abortForShutdown(): void {
    this.abort("worker_shutdown");
  }

  async refresh(): Promise<void> {
    this.throwIfAborted();
    const control = await this.#repository.getRunControl(this.#job.workspaceId, this.#job.runId);

    if (!control) {
      this.abort("run_missing");
      this.throwIfAborted();
      return;
    }

    this.applyControl(control);
    this.throwIfAborted();
  }

  throwIfAborted(): void {
    if (this.signal.aborted) {
      const reason = this.signal.reason;
      throw reason instanceof RunAbortedError ? reason : new RunAbortedError("stale_epoch");
    }
  }

  private async poll(): Promise<void> {
    this.#pollTimeout = null;

    if (this.#stopped || this.signal.aborted) {
      return;
    }

    try {
      await this.refresh();
    } catch (error) {
      if (!(error instanceof RunAbortedError)) {
        this.abort("stale_epoch");
      }
    } finally {
      if (!this.#stopped && !this.signal.aborted) {
        this.#pollTimeout = setTimeout(() => void this.poll(), this.#pollIntervalMs);
      }
    }
  }

  private applyControl(control: RunControl): void {
    if (control.controlVersion < this.#controlVersion) {
      this.abort("stale_epoch");
      return;
    }

    if (control.desiredState === "stopped" && control.stopMode === "immediate") {
      this.abort("immediate_stop");
      return;
    }

    if (control.controlVersion !== this.#controlVersion) {
      const canAdoptGracefulControl =
        control.desiredState === "paused" ||
        (control.desiredState === "stopped" && control.stopMode === "graceful");

      if (!canAdoptGracefulControl) {
        this.abort("stale_epoch");
        return;
      }

      this.#controlVersion = control.controlVersion;
    }

    if (control.desiredState === "paused") {
      this.#finishAfterRound = "paused";
    } else if (control.desiredState === "stopped") {
      this.#finishAfterRound = "graceful_stop";
    }
  }

  private abort(reason: RunAbortReason): void {
    if (!this.signal.aborted) {
      this.#abortController.abort(new RunAbortedError(reason));
    }
  }
}

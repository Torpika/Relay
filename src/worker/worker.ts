import { RoundProcessor } from "@/orchestration/processor";
import type { ClaimedRunJob, OrchestrationRepository } from "@/orchestration/types";
import type { WorkerConfig } from "@/worker/config";

export interface WorkerLogger {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
}

export class OrchestrationWorker {
  readonly #repository: OrchestrationRepository;
  readonly #processor: RoundProcessor;
  readonly #config: WorkerConfig;
  readonly #logger: WorkerLogger;
  readonly #activeJobs = new Set<Promise<void>>();
  readonly #forcedShutdown = new AbortController();
  #stopping = false;

  constructor(
    repository: OrchestrationRepository,
    processor: RoundProcessor,
    config: WorkerConfig,
    logger: WorkerLogger = console
  ) {
    this.#repository = repository;
    this.#processor = processor;
    this.#config = config;
    this.#logger = logger;
  }

  async run(signal?: AbortSignal): Promise<void> {
    const stopListener = () => {
      this.#stopping = true;
    };
    signal?.addEventListener("abort", stopListener, { once: true });
    this.#logger.info({ event: "worker.started", workerId: this.#config.workerId });

    try {
      while (!this.#stopping) {
        await this.fillAvailableSlots();

        if (this.#activeJobs.size >= this.#config.concurrency) {
          await Promise.race(this.#activeJobs);
        } else {
          await delay(this.#config.pollIntervalMs, signal);
        }
      }

      await this.waitForActiveJobs();
    } finally {
      signal?.removeEventListener("abort", stopListener);
      this.#logger.info({ event: "worker.stopped", workerId: this.#config.workerId });
    }
  }

  requestStop(): void {
    this.#stopping = true;
  }

  private async fillAvailableSlots(): Promise<void> {
    while (!this.#stopping && this.#activeJobs.size < this.#config.concurrency) {
      const job = await this.#repository.claimNextJob(
        this.#config.workerId,
        this.#config.leaseMs
      );

      if (!job) {
        return;
      }

      const activeJob = this.processJob(job);
      this.#activeJobs.add(activeJob);
      void activeJob.finally(() => this.#activeJobs.delete(activeJob));
    }
  }

  private async processJob(job: ClaimedRunJob): Promise<void> {
    const leaseController = new AbortController();
    const forcedStopListener = () => leaseController.abort(this.#forcedShutdown.signal.reason);
    this.#forcedShutdown.signal.addEventListener("abort", forcedStopListener, { once: true });
    const renewal = setInterval(() => {
      void this.#repository
        .renewJobLease(job, this.#config.leaseMs)
        .then((renewed) => {
          if (!renewed) {
            leaseController.abort("job_lease_lost");
          }
        })
        .catch(() => leaseController.abort("job_lease_renewal_failed"));
    }, Math.max(1_000, Math.floor(this.#config.leaseMs / 3)));

    try {
      const result = await this.#processor.process(job, leaseController.signal);
      this.#logger.info({
        event: "job.processed",
        workerId: this.#config.workerId,
        jobId: job.id,
        runId: job.runId,
        result
      });
    } catch (error) {
      this.#logger.error({
        event: "job.unhandled_failure",
        workerId: this.#config.workerId,
        jobId: job.id,
        runId: job.runId,
        error: error instanceof Error ? error.message : "Unknown failure"
      });
    } finally {
      clearInterval(renewal);
      this.#forcedShutdown.signal.removeEventListener("abort", forcedStopListener);
    }
  }

  private async waitForActiveJobs(): Promise<void> {
    if (this.#activeJobs.size === 0) {
      return;
    }

    const allJobs = Promise.allSettled([...this.#activeJobs]);
    let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;
    const gracefulWindow = new Promise<"timeout">((resolve) => {
      shutdownTimeout = setTimeout(() => resolve("timeout"), this.#config.shutdownGraceMs);
    });
    const result = await Promise.race([allJobs.then(() => "complete" as const), gracefulWindow]);
    clearTimeout(shutdownTimeout);

    if (result === "timeout") {
      this.#forcedShutdown.abort("worker_shutdown_deadline");
      await allJobs;
    }
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", finish);
      resolve();
    }, milliseconds);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal?.addEventListener("abort", finish, { once: true });
  });
}

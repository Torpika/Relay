import { PostgresOrchestrationRepository } from "@/orchestration/postgres-repository";
import { RoundProcessor } from "@/orchestration/processor";
import { closeCodexRuntime } from "@/orchestration/providers/codex-mcp";
import { closeDatabase } from "@/server/db/client";
import { loadWorkerConfig } from "@/worker/config";
import { OrchestrationWorker } from "@/worker/worker";

const shutdownController = new AbortController();
const requestShutdown = (signal: NodeJS.Signals) => () => {
  console.info(JSON.stringify({ event: "worker.shutdown_requested", signal }));
  shutdownController.abort(signal);
};

process.once("SIGINT", requestShutdown("SIGINT"));
process.once("SIGTERM", requestShutdown("SIGTERM"));

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const repository = new PostgresOrchestrationRepository();
  const processor = new RoundProcessor(repository, {
    providerRequestTimeoutMs: config.providerRequestTimeoutMs
  });
  const logger = {
    info: (data: Record<string, unknown>) => console.info(JSON.stringify(data)),
    error: (data: Record<string, unknown>) => console.error(JSON.stringify(data))
  };
  const worker = new OrchestrationWorker(repository, processor, config, logger);

  try {
    await worker.run(shutdownController.signal);
  } finally {
    await closeCodexRuntime();
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "worker.fatal",
      error: error instanceof Error ? error.message : "Unknown worker failure"
    })
  );
  process.exitCode = 1;
});

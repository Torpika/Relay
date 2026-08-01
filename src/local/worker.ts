import { loadLocalEnvironment } from "@/local/environment";

loadLocalEnvironment();
void import("@/worker/index").catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Relay worker failed to start";
  console.error(message);
  process.exit(1);
});

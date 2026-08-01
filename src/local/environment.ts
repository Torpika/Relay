import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

export function loadLocalEnvironment(): void {
  const environmentPath = resolve(process.cwd(), process.env.RELAY_ENV_FILE ?? ".env");

  if (existsSync(environmentPath)) {
    loadEnvFile(environmentPath);
  }

  if (process.env.HOST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.HOST_DATABASE_URL;
  }
}

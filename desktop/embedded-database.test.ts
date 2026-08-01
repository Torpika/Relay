import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { startEmbeddedDatabase, type EmbeddedDatabaseRuntime } from "./embedded-database";

const temporaryDirectories: string[] = [];
const openDatabases: EmbeddedDatabaseRuntime[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("startEmbeddedDatabase", () => {
  it("migrates a private database and accepts PostgreSQL clients over loopback", async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), "relay-embedded-database-"));
    temporaryDirectories.push(scratchDirectory);
    const runtime = await startEmbeddedDatabase({
      dataDirectory: join(scratchDirectory, "Application Support", "Relay", "database"),
      migrationsDirectory: resolve("db/migrations"),
      assetsDirectory: resolve("node_modules/@electric-sql/pglite/dist")
    });
    openDatabases.push(runtime);
    const sql = postgres(runtime.connectionString, { max: 2, ssl: false });

    try {
      const [{ tableCount }] = await sql<Array<{ tableCount: number }>>`
        SELECT count(*)::int AS "tableCount"
        FROM pg_tables
        WHERE schemaname = 'public'
      `;
      const [{ migrationCount }] = await sql<Array<{ migrationCount: number }>>`
        SELECT count(*)::int AS "migrationCount" FROM schema_migrations
      `;

      expect(tableCount).toBeGreaterThanOrEqual(16);
      expect(migrationCount).toBe(3);
    } finally {
      await sql.end();
    }
  }, 20_000);
});

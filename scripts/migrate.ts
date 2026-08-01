import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations");
}

const migrationsDirectory = resolve(process.cwd(), "db/migrations");
const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  ssl: process.env.DATABASE_SSL === "disable" ? false : "prefer"
});

async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`SELECT pg_advisory_lock(hashtext('relay_schema_migrations'))`;

  try {
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const migrationName of migrationNames) {
      const existing = await sql<{ name: string }[]>`
        SELECT name FROM schema_migrations WHERE name = ${migrationName}
      `;

      if (existing.length > 0) {
        continue;
      }

      const migrationSql = await readFile(resolve(migrationsDirectory, migrationName), "utf8");

      await sql.begin(async (transaction) => {
        await transaction.unsafe(migrationSql);
        await transaction`
          INSERT INTO schema_migrations (name) VALUES (${migrationName})
        `;
      });

      process.stdout.write(`Applied ${migrationName}\n`);
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtext('relay_schema_migrations'))`;
  }
}

try {
  await migrate();
} finally {
  await sql.end();
}

import postgres, { type Sql } from "postgres";

export type Queryable = postgres.TransactionSql;

declare global {
  var relayDatabase: Sql | undefined;
}

function createDatabaseClient(): Sql {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return postgres(databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "prefer",
    transform: {
      undefined: null
    }
  });
}

export function getDatabase(): Sql {
  globalThis.relayDatabase ??= createDatabaseClient();
  return globalThis.relayDatabase;
}

export async function closeDatabase(): Promise<void> {
  if (globalThis.relayDatabase) {
    await globalThis.relayDatabase.end();
    globalThis.relayDatabase = undefined;
  }
}

export async function withTransaction<T>(work: (transaction: Queryable) => Promise<T>): Promise<T> {
  return await getDatabase().begin(work) as T;
}

export async function withWorkspace<T>(workspaceId: string, work: (transaction: Queryable) => Promise<T>): Promise<T> {
  return await getDatabase().begin(async (transaction) => {
    await transaction`SELECT set_config('relay.workspace_id', ${workspaceId}, true)`;
    return work(transaction);
  }) as T;
}

export async function withServiceWorkspace<T>(work: (transaction: Queryable) => Promise<T>): Promise<T> {
  return await getDatabase().begin(async (transaction) => {
    await transaction`SELECT set_config('relay.workspace_id', '*', true)`;
    return work(transaction);
  }) as T;
}

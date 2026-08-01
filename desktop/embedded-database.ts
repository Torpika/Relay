import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export interface EmbeddedDatabaseRuntime {
  connectionString: string;
  close: () => Promise<void>;
}

export async function startEmbeddedDatabase(input: {
  dataDirectory: string;
  migrationsDirectory: string;
  assetsDirectory: string;
}): Promise<EmbeddedDatabaseRuntime> {
  await mkdir(dirname(input.dataDirectory), { recursive: true });
  const [pgliteWasm, initdbWasm, filesystemBundle] = await Promise.all([
    compileWasm(join(input.assetsDirectory, "pglite.wasm")),
    compileWasm(join(input.assetsDirectory, "initdb.wasm")),
    readFile(join(input.assetsDirectory, "pglite.data"))
  ]);
  const database = await PGlite.create(input.dataDirectory, {
    extensions: {
      pgcrypto: pathToFileURL(join(input.assetsDirectory, "pgcrypto.tar.gz"))
    },
    pgliteWasmModule: pgliteWasm,
    initdbWasmModule: initdbWasm,
    fsBundle: new Blob([Uint8Array.from(filesystemBundle)])
  });

  try {
    await applyMigrations(database, input.migrationsDirectory);
    const socketServer = new PGLiteSocketServer({
      db: database,
      host: "127.0.0.1",
      port: 0,
      maxConnections: 32
    });
    await socketServer.start();
    const port = Number(socketServer.getServerConn().split(":").at(-1));

    if (!Number.isInteger(port) || port <= 0) {
      await socketServer.stop();
      throw new Error("The embedded database did not allocate a local port");
    }

    return {
      connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
      close: async () => {
        await socketServer.stop();
        await database.close();
      }
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}

async function applyMigrations(database: PGlite, migrationsDirectory: string): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migrationName of migrationNames) {
    const existing = await database.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = $1",
      [migrationName]
    );

    if (existing.rows.length > 0) {
      continue;
    }

    const migrationSql = await readFile(join(migrationsDirectory, migrationName), "utf8");
    await database.transaction(async (transaction) => {
      await transaction.exec(migrationSql);
      await transaction.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migrationName]);
    });
  }
}

async function compileWasm(path: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(Uint8Array.from(await readFile(path)));
}

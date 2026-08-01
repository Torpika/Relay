import { getDatabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const [result] = await getDatabase()<[{ database: number; schema_ready: boolean }]>`
      SELECT 1 AS database, to_regclass('public.runs') IS NOT NULL AS schema_ready
    `;
    const healthy = result?.database === 1 && result.schema_ready;

    return Response.json(
      { status: healthy ? "healthy" : "not_ready", database: true, schemaReady: result?.schema_ready ?? false },
      {
        status: healthy ? 200 : 503,
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch {
    return Response.json(
      { status: "unhealthy", database: false, schemaReady: false },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}

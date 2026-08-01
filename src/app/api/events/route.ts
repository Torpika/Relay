import { z } from "zod";
import { requireViewer } from "@/server/auth/session";
import { createEventStream } from "@/server/events/stream";
import { apiRoute } from "@/server/http/errors";

const eventQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  after: z.coerce.number().int().nonnegative().optional()
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireViewer(request);
  const url = new URL(request.url);
  const lastEventId = request.headers.get("last-event-id");
  const query = eventQuerySchema.parse({
    conversationId: url.searchParams.get("conversationId") ?? undefined,
    runId: url.searchParams.get("runId") ?? undefined,
    after: url.searchParams.get("after") ?? lastEventId ?? undefined
  });
  const stream = createEventStream(
    {
      workspaceId: viewer.workspaceId,
      conversationId: query.conversationId,
      runId: query.runId,
      after: query.after ?? 0
    },
    request.signal
  );

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      Vary: "Cookie"
    }
  });
});

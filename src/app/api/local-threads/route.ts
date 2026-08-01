import { z } from "zod";
import { discoverLocalThreads, importLocalThread } from "@/local/threads/discover";
import { requireViewer } from "@/server/auth/session";
import { ApiError, apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  await requireViewer(request);
  return jsonResponse(discoverLocalThreads(process.env.RELAY_LOCAL_THREAD_HOME));
});

const importThreadSchema = z.strictObject({ threadId: z.string().min(1).max(500) });

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  await requireViewer(request);
  const input = await parseJson(request, importThreadSchema);
  const thread = importLocalThread(input.threadId, process.env.RELAY_LOCAL_THREAD_HOME);

  if (!thread) {
    throw new ApiError(404, "local_thread_not_found", "The selected local AI task is no longer available");
  }

  return jsonResponse(thread);
});

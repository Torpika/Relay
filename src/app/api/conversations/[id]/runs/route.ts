import { z } from "zod";
import { requireRole, requireViewer } from "@/server/auth/session";
import { startConversationRun } from "@/server/conversations/service";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { startRunSchema } from "@/server/runs/schemas";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const conversationId = z.string().uuid().parse((await context.params).id);
  const input = request.headers.get("content-type")
    ? await parseJson(request, startRunSchema)
    : startRunSchema.parse({});
  const run = await startConversationRun(viewer.workspaceId, conversationId, input);
  return jsonResponse({ run }, { status: 201 });
});

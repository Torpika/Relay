import { z } from "zod";
import { requireRole, requireViewer } from "@/server/auth/session";
import { updateConversationSchema } from "@/server/conversations/schemas";
import { deleteConversation, getConversation, updateConversation } from "@/server/conversations/service";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const identifier = z.string().uuid();

export const GET = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  const viewer = await requireViewer(request);
  const conversationId = identifier.parse((await context.params).id);
  return jsonResponse(await getConversation(viewer.workspaceId, conversationId));
});

export const PATCH = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const conversationId = identifier.parse((await context.params).id);
  const input = await parseJson(request, updateConversationSchema);
  return jsonResponse(await updateConversation(viewer.workspaceId, conversationId, input));
});

export const DELETE = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin"]);
  const conversationId = identifier.parse((await context.params).id);
  await deleteConversation(viewer.workspaceId, conversationId);
  return new Response(null, { status: 204 });
});

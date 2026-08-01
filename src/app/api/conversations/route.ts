import { requireRole, requireViewer } from "@/server/auth/session";
import { createConversationSchema } from "@/server/conversations/schemas";
import { createConversation, listConversations } from "@/server/conversations/service";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { assertTrustedOrigin } from "@/server/security/origin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireViewer(request);
  return jsonResponse({ conversations: await listConversations(viewer.workspaceId) });
});

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const input = await parseJson(request, createConversationSchema);
  return jsonResponse(await createConversation(viewer.workspaceId, input), { status: 201 });
});

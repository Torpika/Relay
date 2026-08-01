import { z } from "zod";
import { updateAgentSchema } from "@/server/agents/schemas";
import { deleteAgent, updateAgent } from "@/server/agents/service";
import { requireRole, requireViewer } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const identifier = z.string().uuid();

export const PATCH = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const agentId = identifier.parse((await context.params).id);
  return jsonResponse(await updateAgent(viewer.workspaceId, agentId, await parseJson(request, updateAgentSchema)));
});

export const DELETE = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin"]);
  const agentId = identifier.parse((await context.params).id);
  await deleteAgent(viewer.workspaceId, agentId);
  return new Response(null, { status: 204 });
});

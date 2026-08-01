import { createAgentSchema } from "@/server/agents/schemas";
import { createAgent, listAgents } from "@/server/agents/service";
import { requireRole, requireViewer } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { assertTrustedOrigin } from "@/server/security/origin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireViewer(request);
  return jsonResponse({ agents: await listAgents(viewer.workspaceId) });
});

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const input = await parseJson(request, createAgentSchema);
  return jsonResponse(await createAgent(viewer.workspaceId, input), { status: 201 });
});

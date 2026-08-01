import { requireRole, requireViewer } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { createProviderSchema } from "@/server/providers/schemas";
import { createProviderConnection, listProviderConnections } from "@/server/providers/service";
import { assertTrustedOrigin } from "@/server/security/origin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireViewer(request);
  return jsonResponse({ connections: await listProviderConnections(viewer.workspaceId) });
});

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const input = await parseJson(request, createProviderSchema);
  const connection = await createProviderConnection(viewer.workspaceId, input);
  return jsonResponse(connection, { status: 201 });
});

import { z } from "zod";
import { requireRole, requireViewer } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { updateProviderSchema } from "@/server/providers/schemas";
import { deleteProviderConnection, updateProviderConnection } from "@/server/providers/service";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const identifier = z.string().uuid();

export const PATCH = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const connectionId = identifier.parse((await context.params).id);
  const input = await parseJson(request, updateProviderSchema);
  return jsonResponse(await updateProviderConnection(viewer.workspaceId, connectionId, input));
});

export const DELETE = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin"]);
  const connectionId = identifier.parse((await context.params).id);
  await deleteProviderConnection(viewer.workspaceId, connectionId);
  return new Response(null, { status: 204 });
});

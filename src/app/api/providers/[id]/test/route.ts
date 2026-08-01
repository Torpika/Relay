import { z } from "zod";
import { requireRole, requireViewer } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse } from "@/server/http/request";
import { testProviderConnection } from "@/server/providers/service";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const connectionId = z.string().uuid().parse((await context.params).id);
  return jsonResponse(await testProviderConnection(viewer.workspaceId, connectionId));
});

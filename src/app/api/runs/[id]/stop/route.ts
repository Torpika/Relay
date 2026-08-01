import { z } from "zod";
import { requireRole, requireViewer } from "@/server/auth/session";
import { changeRunState } from "@/server/conversations/service";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { stopRunSchema } from "@/server/runs/schemas";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext { params: Promise<{ id: string }> }

export const POST = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const runId = z.string().uuid().parse((await context.params).id);
  const input = await parseJson(request, stopRunSchema);
  return jsonResponse(await changeRunState(viewer.workspaceId, runId, "stop", input));
});

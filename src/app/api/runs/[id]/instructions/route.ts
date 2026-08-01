import { z } from "zod";
import { requireRole, requireViewer } from "@/server/auth/session";
import { addRunInstruction } from "@/server/conversations/service";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { instructionSchema } from "@/server/runs/schemas";
import { assertTrustedOrigin } from "@/server/security/origin";

interface RouteContext { params: Promise<{ id: string }> }

export const POST = apiRoute(async (request: Request, context: RouteContext): Promise<Response> => {
  assertTrustedOrigin(request);
  const viewer = await requireViewer(request);
  requireRole(viewer, ["owner", "admin", "operator"]);
  const runId = z.string().uuid().parse((await context.params).id);
  const input = await parseJson(request, instructionSchema);
  return jsonResponse({ pendingInstruction: await addRunInstruction(viewer.workspaceId, runId, input.instruction) });
});

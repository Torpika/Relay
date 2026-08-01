import { requireViewer } from "@/server/auth/session";
import { getDashboard } from "@/server/dashboard/service";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse } from "@/server/http/request";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const viewer = await requireViewer(request);
  return jsonResponse(await getDashboard(viewer));
});

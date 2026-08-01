import { getViewer } from "@/server/auth/session";
import { ApiError, apiRoute } from "@/server/http/errors";
import { jsonResponse } from "@/server/http/request";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const viewer = await getViewer(request);

  if (!viewer) {
    throw new ApiError(401, "authentication_required", "Authentication is required");
  }

  return jsonResponse({ viewer });
});

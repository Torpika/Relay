import { clearSessionCookie } from "@/server/auth/cookies";
import { revokeSession } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { assertTrustedOrigin } from "@/server/security/origin";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  assertTrustedOrigin(request);
  await revokeSession(request);
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearSessionCookie(),
      "Cache-Control": "no-store"
    }
  });
});

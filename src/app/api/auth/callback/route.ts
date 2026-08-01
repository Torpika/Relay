import { appUrl } from "@/server/auth/config";
import { createSessionCookie } from "@/server/auth/cookies";
import { completeAuthorization } from "@/server/auth/oidc";
import { createAuthenticatedSession } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const { identity, returnTo } = await completeAuthorization(request);
  const session = await createAuthenticatedSession(identity, request);
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(returnTo, appUrl()).toString(),
      "Set-Cookie": createSessionCookie(session.token, session.expiresAt),
      "Cache-Control": "no-store"
    }
  });
});

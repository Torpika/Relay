import { appUrl, getAuthMode } from "@/server/auth/config";
import { createSessionCookie } from "@/server/auth/cookies";
import { createAuthorizationUrl, safeReturnTo } from "@/server/auth/oidc";
import { createAuthenticatedSession } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<Response> => {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  if (getAuthMode() === "development") {
    const email = process.env.DEV_AUTH_EMAIL ?? "developer@relay.local";
    const name = process.env.DEV_AUTH_NAME ?? "Local Developer";
    const session = await createAuthenticatedSession(
      {
        issuer: "urn:relay:development",
        subject: email.toLowerCase(),
        email: email.toLowerCase(),
        name
      },
      request
    );
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(returnTo, appUrl()).toString(),
        "Set-Cookie": createSessionCookie(session.token, session.expiresAt),
        "Cache-Control": "no-store"
      }
    });
  }

  const authorizationUrl = await createAuthorizationUrl(returnTo);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      "Cache-Control": "no-store"
    }
  });
});

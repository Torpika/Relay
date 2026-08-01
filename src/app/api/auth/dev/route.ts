import { z } from "zod";
import { requireDevelopmentAuthMode } from "@/server/auth/config";
import { createSessionCookie } from "@/server/auth/cookies";
import { createAuthenticatedSession } from "@/server/auth/session";
import { apiRoute } from "@/server/http/errors";
import { jsonResponse, parseJson } from "@/server/http/request";
import { assertTrustedOrigin } from "@/server/security/origin";

const developmentLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(120)
}).strict();

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  requireDevelopmentAuthMode();
  assertTrustedOrigin(request);
  const input = await parseJson(request, developmentLoginSchema);
  const session = await createAuthenticatedSession(
    {
      issuer: "urn:relay:development",
      subject: input.email,
      email: input.email,
      name: input.name
    },
    request
  );
  const response = jsonResponse({ viewer: session.viewer }, { status: 201 });
  response.headers.set("Set-Cookie", createSessionCookie(session.token, session.expiresAt));
  return response;
});

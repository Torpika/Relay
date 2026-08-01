import { localDevelopmentAuthEnabled } from "@/server/auth/config";

const developmentCookieName = "relay_session";
const productionCookieName = "__Host-relay_session";

function secureCookiesRequired(): boolean {
  return process.env.NODE_ENV === "production" && !localDevelopmentAuthEnabled();
}

export function sessionCookieName(): string {
  return secureCookiesRequired() ? productionCookieName : developmentCookieName;
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const candidateName = cookie.slice(0, separator).trim();

    if (candidateName === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }

  return null;
}

export function createSessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = secureCookiesRequired() ? "; Secure" : "";

  return `${sessionCookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}`;
}

export function clearSessionCookie(): string {
  const secure = secureCookiesRequired() ? "; Secure" : "";
  return `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

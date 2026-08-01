import { createHash } from "node:crypto";
import * as oidc from "openid-client";
import { appUrl, requireOidcMode } from "@/server/auth/config";
import { getDatabase, withTransaction } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

interface LoginAttempt {
  nonce: string;
  code_verifier: string;
  return_to: string;
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

let configurationPromise: Promise<oidc.Configuration> | undefined;

function oidcEnvironment(): { issuer: string; clientId: string; clientSecret: string } {
  const issuer = process.env.OIDC_ISSUER ?? process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    throw new Error("OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET are required");
  }

  return { issuer, clientId, clientSecret };
}

async function configuration(): Promise<oidc.Configuration> {
  requireOidcMode();
  const { issuer, clientId, clientSecret } = oidcEnvironment();
  configurationPromise ??= oidc.discovery(
    new URL(issuer),
    clientId,
    { client_secret: clientSecret, redirect_uris: [callbackUrl()] },
    oidc.ClientSecretBasic(clientSecret)
  );
  return configurationPromise;
}

function callbackUrl(): string {
  return new URL("/api/auth/callback", appUrl()).toString();
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  return value;
}

export async function createAuthorizationUrl(returnTo: string): Promise<URL> {
  const config = await configuration();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await withTransaction(async (transaction) => {
    await transaction`DELETE FROM oidc_login_attempts WHERE expires_at <= now()`;
    await transaction`
      INSERT INTO oidc_login_attempts (state_hash, nonce, code_verifier, return_to, expires_at)
      VALUES (${stateHash(state)}, ${nonce}, ${codeVerifier}, ${safeReturnTo(returnTo)}, ${expiresAt})
    `;
  });

  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(),
    scope: process.env.OIDC_SCOPES ?? "openid profile email",
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce
  });
}

async function consumeLoginAttempt(state: string): Promise<LoginAttempt> {
  const [attempt] = await getDatabase()<LoginAttempt[]>`
    DELETE FROM oidc_login_attempts
    WHERE state_hash = ${stateHash(state)}
      AND expires_at > now()
    RETURNING nonce, code_verifier, return_to
  `;

  if (!attempt) {
    throw new ApiError(400, "invalid_oidc_state", "The authentication request is invalid or expired");
  }

  return attempt;
}

export async function completeAuthorization(request: Request): Promise<{ identity: OidcIdentity; returnTo: string }> {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state");

  if (!state) {
    throw new ApiError(400, "missing_oidc_state", "The authentication response did not include state");
  }

  const attempt = await consumeLoginAttempt(state);
  const config = await configuration();
  const tokens = await oidc.authorizationCodeGrant(
    config,
    requestUrl,
    {
      expectedState: state,
      expectedNonce: attempt.nonce,
      pkceCodeVerifier: attempt.code_verifier,
      idTokenExpected: true
    },
    { redirect_uri: callbackUrl() }
  );
  const claims = tokens.claims();

  if (!claims?.sub) {
    throw new ApiError(400, "invalid_identity", "The identity provider did not return a subject identifier");
  }

  let email = typeof claims.email === "string" ? claims.email : undefined;
  let name = typeof claims.name === "string" ? claims.name : undefined;
  let picture = typeof claims.picture === "string" ? claims.picture : null;

  if ((!email || !name) && tokens.access_token) {
    const userInfo = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
    email ??= typeof userInfo.email === "string" ? userInfo.email : undefined;
    name ??= typeof userInfo.name === "string" ? userInfo.name : undefined;
    picture ??= typeof userInfo.picture === "string" ? userInfo.picture : null;
  }

  if (!email) {
    throw new ApiError(400, "missing_email", "The identity provider did not return an email address");
  }

  if (claims.email_verified === false) {
    throw new ApiError(403, "unverified_email", "A verified email address is required");
  }

  return {
    identity: {
      issuer: oidcEnvironment().issuer,
      subject: claims.sub,
      email,
      name: name ?? email.split("@", 1)[0],
      avatarUrl: picture
    },
    returnTo: attempt.return_to
  };
}

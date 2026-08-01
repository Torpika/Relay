import { ApiError } from "@/server/http/errors";

export type AuthMode = "oidc" | "development";

export function localDevelopmentAuthEnabled(): boolean {
  if (process.env.AUTH_MODE !== "development" || process.env.ALLOW_LOCAL_DEVELOPMENT_AUTH !== "true") {
    return false;
  }

  const hostname = appUrl().hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function developmentAuthAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return localDevelopmentAuthEnabled();
}

export function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === "production" ? "oidc" : "development");

  if (mode !== "oidc" && mode !== "development") {
    throw new Error("AUTH_MODE must be either oidc or development");
  }

  if (mode === "development" && !developmentAuthAllowed()) {
    throw new Error("Development authentication cannot run in production");
  }

  return mode;
}

export function requireOidcMode(): void {
  if (getAuthMode() !== "oidc") {
    throw new ApiError(404, "not_found", "OIDC authentication is not enabled");
  }
}

export function requireDevelopmentAuthMode(): void {
  if (getAuthMode() !== "development" || !developmentAuthAllowed()) {
    throw new ApiError(404, "not_found", "Development authentication is not enabled");
  }
}

export function appUrl(): URL {
  const value = process.env.APP_URL;

  if (!value) {
    throw new Error("APP_URL is required");
  }

  return new URL(value);
}

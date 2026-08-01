import { ApiError } from "@/server/http/errors";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  const configured = [process.env.APP_URL, ...(process.env.AUTH_TRUSTED_ORIGINS ?? "").split(",")];

  for (const value of configured) {
    const candidate = value?.trim();

    if (!candidate) {
      continue;
    }

    try {
      origins.add(new URL(candidate).origin);
    } catch {
      throw new Error(`Invalid trusted origin: ${candidate}`);
    }
  }

  return origins;
}

export function assertTrustedOrigin(request: Request): void {
  if (safeMethods.has(request.method.toUpperCase())) {
    return;
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "untrusted_origin", "Cross-site requests are not allowed");
  }

  const originHeader = request.headers.get("origin");

  if (!originHeader || originHeader === "null") {
    throw new ApiError(403, "missing_origin", "A trusted Origin header is required");
  }

  let requestOrigin: string;

  try {
    requestOrigin = new URL(originHeader).origin;
  } catch {
    throw new ApiError(403, "untrusted_origin", "The request Origin header is invalid");
  }

  const allowedOrigins = configuredOrigins();

  if (allowedOrigins.size === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_URL or AUTH_TRUSTED_ORIGINS is required in production");
    }
    allowedOrigins.add(new URL(request.url).origin);
  }

  if (!allowedOrigins.has(requestOrigin)) {
    throw new ApiError(403, "untrusted_origin", "The request origin is not trusted");
  }
}

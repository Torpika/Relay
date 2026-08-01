import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ProviderKind } from "@/lib/contracts";
import { ApiError } from "@/server/http/errors";

const fixedProviderUrls: Partial<Record<ProviderKind, string>> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  moonshot: "https://api.moonshot.ai/v1"
};

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    octets[0] >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function customProviderHosts(): Set<string> {
  return new Set(
    (process.env.CUSTOM_PROVIDER_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function normalizeProviderBaseUrl(kind: ProviderKind, value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_provider_url", "Provider base URL must be a valid absolute URL");
  }

  const allowPrivateDevelopmentUrl =
    process.env.NODE_ENV !== "production" && process.env.ALLOW_PRIVATE_PROVIDER_URLS === "true";

  if (url.protocol !== "https:" && !(allowPrivateDevelopmentUrl && url.protocol === "http:")) {
    throw new ApiError(400, "invalid_provider_url", "Provider base URL must use HTTPS");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "invalid_provider_url", "Provider base URL cannot contain credentials, a query, or a fragment");
  }

  const normalizedUrl = url.toString().replace(/\/$/, "");
  const fixedUrl = fixedProviderUrls[kind];

  if (fixedUrl && normalizedUrl !== fixedUrl) {
    throw new ApiError(400, "invalid_provider_url", `${kind} connections must use ${fixedUrl}`);
  }

  if (kind === "custom" && process.env.NODE_ENV === "production") {
    const allowedHosts = customProviderHosts();
    const hostWithPort = url.port ? `${url.hostname.toLowerCase()}:${url.port}` : url.hostname.toLowerCase();

    if (allowedHosts.size === 0 || !allowedHosts.has(hostWithPort)) {
      throw new ApiError(400, "provider_host_not_allowed", "Custom provider hostname is not allowlisted");
    }
  }

  return normalizedUrl;
}

export async function assertSafeProviderDestination(baseUrl: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_PROVIDER_URLS === "true" && process.env.NODE_ENV !== "production") {
    return;
  }

  const hostname = new URL(baseUrl).hostname;
  let addresses: Array<{ address: string; family: number }>;

  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, "provider_dns_failed", "Provider hostname could not be resolved");
  }

  if (addresses.length === 0) {
    throw new ApiError(400, "provider_dns_failed", "Provider hostname did not resolve to an address");
  }

  const unsafeAddress = addresses.some(({ address }) => {
    const family = isIP(address);
    return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : true;
  });

  if (unsafeAddress) {
    throw new ApiError(400, "unsafe_provider_url", "Provider hostname resolves to a private or reserved address");
  }
}

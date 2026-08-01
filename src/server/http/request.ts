import type { ZodType } from "zod";
import { ApiError } from "@/server/http/errors";

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();

  if (contentType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Expected an application/json request body");
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON");
  }

  return schema.parse(body);
}

export function noStoreHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store, max-age=0");
  result.set("Vary", "Cookie");
  return result;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: noStoreHeaders(init?.headers)
  });
}

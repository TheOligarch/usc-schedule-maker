// HTTP plumbing shared by every function: CORS, JSON responses, input parsing.
import { z } from "./deps.ts";

/** Response header telling the caller whether the model or the built-in fallback answered. */
export const SOURCE_HEADER = "x-usm-ai-source";

const MAX_BODY_BYTES = 256 * 1024;

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": SOURCE_HEADER,
  "Access-Control-Max-Age": "86400",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function errorResponse(err: HttpError): Response {
  return json(
    { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
    err.status,
  );
}

/** Reads and validates a JSON body, turning every failure into a clear 4xx. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", `Request body must be under ${MAX_BODY_BYTES / 1024} KB`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "invalid_request",
      "Request body does not match the expected shape",
      parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * Wraps a handler with CORS preflight, method checking and a JSON error boundary.
 * Nothing thrown here ever carries a secret: unknown errors become a bare 500.
 */
export function serve(method: "GET" | "POST", handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (req.method !== method) {
        throw new HttpError(405, "method_not_allowed", `Use ${method} for this endpoint`);
      }
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      console.error("[http] unhandled error:", err instanceof Error ? err.name : typeof err);
      return errorResponse(new HttpError(500, "internal_error", "Unexpected server error"));
    }
  };
}

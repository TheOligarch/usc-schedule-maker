// The only place that knows which Claude model is used and how it is called.
// Change the model by setting the AI_MODEL function secret; nothing else needs editing.
import { Anthropic, z, zodOutputFormat } from "./deps.ts";

/** Used when the AI_MODEL secret is unset. */
export const DEFAULT_MODEL = "claude-haiku-5-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function resolveModel(): string {
  // Used exactly as configured: a wrong ID should fail visibly in ai-health.
  return Deno.env.get("AI_MODEL")?.trim() || DEFAULT_MODEL;
}

/**
 * AI_EFFORT (optional secret): a level forces that effort on every call, "off"
 * omits the parameter (for models that reject it); unset uses each call's default.
 */
function resolveEffort(callDefault: Effort): Effort | undefined {
  const raw = Deno.env.get("AI_EFFORT")?.trim().toLowerCase();
  if (!raw) return callDefault;
  if (raw === "off") return undefined;
  return (EFFORTS as readonly string[]).includes(raw) ? (raw as Effort) : callDefault;
}

export class ModelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export interface GenerateOptions<T> {
  /** Short name for logs. */
  label: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: Effort;
}

export interface ModelClient {
  readonly model: string;
  readonly keyPresent: boolean;
  /** One structured-output call; throws ModelError on any failure. */
  generate<T>(opts: GenerateOptions<T>): Promise<T>;
  /** One tiny call that proves the key and model work; throws ModelError otherwise. */
  ping(): Promise<void>;
}

/** Removes anything key-shaped, so an error can be logged or returned safely. */
export function redact(text: string, secret?: string): string {
  let out = text;
  if (secret) out = out.split(secret).join("[redacted]");
  return out.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
}

function toModelError(err: unknown, secret?: string): ModelError {
  if (err instanceof ModelError) return err;
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    const code = err instanceof Anthropic.AuthenticationError
      ? "authentication_error"
      : err instanceof Anthropic.PermissionDeniedError
      ? "permission_error"
      : err instanceof Anthropic.NotFoundError
      ? "not_found_error"
      : err instanceof Anthropic.RateLimitError
      ? "rate_limit_error"
      : err instanceof Anthropic.BadRequestError
      ? "invalid_request_error"
      : err instanceof Anthropic.APIConnectionError
      ? "connection_error"
      : "api_error";
    return new ModelError(code, redact(err.message, secret), status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ModelError("unexpected_error", redact(message, secret));
}

export function createModelClient(): ModelClient {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim() || undefined;
  const model = resolveModel();
  let client: Anthropic | undefined;

  function sdk(): Anthropic {
    if (!apiKey) {
      throw new ModelError("missing_key", "ANTHROPIC_API_KEY is not set for this function");
    }
    client ??= new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
    return client;
  }

  async function guarded<R>(label: string, run: (c: Anthropic) => Promise<R>): Promise<R> {
    try {
      return await run(sdk());
    } catch (err) {
      const mapped = toModelError(err, apiKey);
      console.error(
        `[model] ${label} failed: ${mapped.code}${mapped.status ? ` (${mapped.status})` : ""}: ${mapped.message}`,
      );
      throw mapped;
    }
  }

  return {
    model,
    keyPresent: Boolean(apiKey),

    generate<T>(opts: GenerateOptions<T>): Promise<T> {
      return guarded(opts.label, async (c) => {
        const effort = resolveEffort(opts.effort ?? "low");
        const response = await c.messages.parse({
          model,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
          output_config: {
            format: zodOutputFormat(opts.schema),
            ...(effort ? { effort } : {}),
          },
        });
        if (response.stop_reason === "refusal") {
          throw new ModelError("refusal", "the model declined this request");
        }
        if (response.stop_reason === "max_tokens") {
          throw new ModelError("max_tokens", "the model ran out of output tokens");
        }
        if (response.parsed_output == null) {
          throw new ModelError("unparseable_output", "the model returned no parseable output");
        }
        return response.parsed_output as T;
      });
    },

    ping(): Promise<void> {
      return guarded("ping", async (c) => {
        const effort = resolveEffort("low");
        await c.messages.create({
          model,
          max_tokens: 256,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          ...(effort ? { output_config: { effort } } : {}),
        });
      });
    },
  };
}

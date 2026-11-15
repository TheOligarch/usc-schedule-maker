// Per-install, per-IP and global budgets for the AI functions, weighted by what each model call
// sends: every call is charged ceil(prompt characters / 4000) units (about 1,000 tokens per unit,
// at least 1) right before it is made, and a call over budget is never made. One small request can
// make the interview build a very large prompt, so counting HTTP requests alone would be weak.
// Counters live in public.ai_rate_counters behind the ai_rate_limit_take RPC (service role only;
// see supabase/migrations/*_create_ai_rate_limits.sql). Every number here is read from function
// secrets, so limits change without an extension release. If the counter store fails, the call
// is let through and the failure is logged: a limiter outage must never block students.
import { HttpError } from "./http.ts";
import { GenerateOptions, ModelClient, ModelError } from "./model.ts";
import { LimitScope, rateLimitMessage } from "./rate-limit-message.ts";

export { rateLimitMessage, waitPhrase } from "./rate-limit-message.ts";
export type { LimitScope } from "./rate-limit-message.ts";

export type Endpoint = "interview" | "explain" | "refine" | "ai-health";

/** Header the extension sends: a random UUID generated once per install, linked to nothing else. */
export const INSTALL_ID_HEADER = "x-usm-install-id";

export const HOUR = 3600;
export const DAY = 86400;

export interface Budget {
  hour: number;
  day: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  /** Units per install ID, per endpoint. */
  perUser: Record<Endpoint, Budget>;
  /** Per hashed client IP = perUser x this, so a whole campus NAT fits under it. */
  ipMultiplier: number;
  /** Units for all endpoints and all callers together, per UTC day: the breaker below the Anthropic account cap. */
  globalDay: number;
  /** Salt for hashing client IPs; without it no IP-based bucket is used (raw IPs are never stored). */
  ipSalt: string | null;
  /** Request headers to read the client IP from, first match wins. */
  ipHeaders: string[];
}

/** Prompt characters per unit (about 1,000 tokens). */
export const CHARS_PER_UNIT = 4000;

/** Units one model call is charged: its system prompt plus user message, at least 1. */
export function callWeight(promptChars: number): number {
  return Math.max(1, Math.ceil(promptChars / CHARS_PER_UNIT));
}

/**
 * Unit budgets per planning session, measured from the prompts the code builds (README "Rate
 * limits"): an interview is ~5-10 question calls of 1-2 units, one search call and one final call
 * of ~12 units per GE slot shortlisted (60 covers several slots and a rewind); explain is ~2 units
 * per call, ~6 calls; refine ~3 units per call, ~6 calls. The extension never calls ai-health.
 * Sized for ~10 sessions per hour and ~30 per day.
 */
export const DEFAULT_PER_USER: Record<Endpoint, Budget> = {
  interview: { hour: 600, day: 1800 }, // 60 per session
  explain: { hour: 150, day: 450 }, // 15 per session
  refine: { hour: 250, day: 750 }, // 25 per session
  "ai-health": { hour: 6, day: 20 }, // diagnostics only (1 unit per ping)
};
export const DEFAULT_IP_MULTIPLIER = 30;
/** ~100M prompt tokens a day across everyone, about 2,000 typical sessions. */
export const DEFAULT_GLOBAL_DAY = 100000;
export const DEFAULT_IP_HEADERS = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"];

const ENDPOINTS = Object.keys(DEFAULT_PER_USER) as Endpoint[];
const envName = (endpoint: Endpoint, window: "HOUR" | "DAY") => `RATE_LIMIT_${endpoint.replace("-", "_").toUpperCase()}_${window}`;

type Env = (name: string) => string | undefined;
const denoEnv: Env = (name) => Deno.env.get(name);

function intFrom(env: Env, name: string, fallback: number, min = 0): number {
  const raw = env(name)?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    console.warn(`[rate-limit] ignoring ${name}=${JSON.stringify(raw)}; using ${fallback}`);
    return fallback;
  }
  return n;
}

/**
 * Secrets (all optional): RATE_LIMIT_ENABLED (false/off/0 disables), RATE_LIMIT_<ENDPOINT>_HOUR and
 * _DAY (ENDPOINT = INTERVIEW, EXPLAIN, REFINE, AI_HEALTH), RATE_LIMIT_IP_MULTIPLIER,
 * RATE_LIMIT_GLOBAL_DAY, RATE_LIMIT_IP_SALT, RATE_LIMIT_IP_HEADER (comma-separated header names).
 */
export function loadRateLimitConfig(env: Env = denoEnv): RateLimitConfig {
  const perUser = Object.fromEntries(
    ENDPOINTS.map((e) => [e, {
      hour: intFrom(env, envName(e, "HOUR"), DEFAULT_PER_USER[e].hour),
      day: intFrom(env, envName(e, "DAY"), DEFAULT_PER_USER[e].day),
    }]),
  ) as Record<Endpoint, Budget>;
  const headers = env("RATE_LIMIT_IP_HEADER")?.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return {
    enabled: !/^(false|off|0|no)$/i.test(env("RATE_LIMIT_ENABLED")?.trim() ?? ""),
    perUser,
    ipMultiplier: intFrom(env, "RATE_LIMIT_IP_MULTIPLIER", DEFAULT_IP_MULTIPLIER, 1),
    globalDay: intFrom(env, "RATE_LIMIT_GLOBAL_DAY", DEFAULT_GLOBAL_DAY),
    ipSalt: env("RATE_LIMIT_IP_SALT")?.trim() || null,
    ipHeaders: headers?.length ? headers : DEFAULT_IP_HEADERS,
  };
}

export interface Bucket {
  key: string;
  window: number;
  limit: number;
  scope: LimitScope;
}

export type Decision = { allowed: true } | { allowed: false; scope: LimitScope; retryAfter: number };

export interface CounterStore {
  /** Charges `weight` units to every bucket, or to none if any would overflow. Throws on storage failure. */
  take(buckets: Bucket[], weight: number): Promise<Decision>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The install ID header, if it is a well-formed UUID (anything else is ignored). */
export function installIdFrom(req: Request): string | null {
  const raw = req.headers.get(INSTALL_ID_HEADER)?.trim().toLowerCase() ?? "";
  return UUID_RE.test(raw) ? raw : null;
}

/** The client IP from the first configured header present; for x-forwarded-for, its first entry. */
export function clientIp(req: Request, headers: string[] = DEFAULT_IP_HEADERS): string | null {
  for (const name of headers) {
    const value = req.headers.get(name)?.split(",")[0].trim();
    if (value) return value.slice(0, 64);
  }
  return null;
}

/** HMAC-SHA-256 of the IP under the salt, hex, truncated to 128 bits. The raw IP is never stored. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(ip)));
  return Array.from(mac.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The buckets a model call for `endpoint` is charged to, ordered user, network, global. */
export async function bucketsFor(req: Request, endpoint: Endpoint, config: RateLimitConfig): Promise<Bucket[]> {
  const budget = config.perUser[endpoint];
  const ip = config.ipSalt ? clientIp(req, config.ipHeaders) : null;
  const ipHash = ip && config.ipSalt ? await hashIp(ip, config.ipSalt) : null;
  // No usable install ID (an old build or a script): the hashed network stands in for the user.
  const userId = installIdFrom(req) ?? (ipHash ? `ip-${ipHash}` : null);

  const buckets: Bucket[] = [];
  if (userId) {
    buckets.push(
      { key: `user:${endpoint}:${userId}:h`, window: HOUR, limit: budget.hour, scope: "user" },
      { key: `user:${endpoint}:${userId}:d`, window: DAY, limit: budget.day, scope: "user" },
    );
  }
  if (ipHash) {
    buckets.push(
      { key: `net:${endpoint}:${ipHash}:h`, window: HOUR, limit: budget.hour * config.ipMultiplier, scope: "network" },
      { key: `net:${endpoint}:${ipHash}:d`, window: DAY, limit: budget.day * config.ipMultiplier, scope: "network" },
    );
  }
  buckets.push({ key: "global:all:d", window: DAY, limit: config.globalDay, scope: "global" });
  return buckets;
}

/** Counter store backed by the ai_rate_limit_take RPC, called through PostgREST with the service-role key. */
export function createPostgrestStore(
  config: { url: string; key: string },
  fetchFn: typeof fetch = fetch,
  timeoutMs = 3000,
): CounterStore {
  return {
    async take(buckets, weight) {
      const res = await fetchFn(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/ai_rate_limit_take`, {
        method: "POST",
        headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_buckets: buckets, p_weight: weight }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { code?: string } | null;
        throw new Error(`counter RPC failed: HTTP ${res.status} ${body?.code ?? ""}`.trim());
      }
      const out = await res.json() as { allowed?: unknown; scope?: unknown; retryAfter?: unknown };
      if (out?.allowed === true) return { allowed: true };
      if (out?.allowed === false) {
        const scope: LimitScope = out.scope === "global" || out.scope === "network" ? out.scope : "user";
        const retryAfter = typeof out.retryAfter === "number" && out.retryAfter > 0 ? Math.ceil(out.retryAfter) : 60;
        return { allowed: false, scope, retryAfter };
      }
      throw new Error("counter RPC returned an unexpected body");
    },
  };
}

/** The default store from the function's own environment, or null when the service key is missing. */
export function storeFromEnv(env: Env = denoEnv): CounterStore | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createPostgrestStore({ url, key }) : null;
}

/** HTTP 429 with Retry-After and a body the extension renders: error.details = { scope, retryAfterSeconds }. */
export function rateLimitedError(scope: LimitScope, retryAfter: number): HttpError {
  return new HttpError(429, "rate_limited", rateLimitMessage(scope, retryAfter), { scope, retryAfterSeconds: retryAfter }, {
    "Retry-After": String(retryAfter),
  });
}

export interface RateLimitDeps {
  config?: RateLimitConfig;
  store?: CounterStore | null;
}

export interface RateLimitGuard {
  /** The model client to hand to the endpoint: charges each call before making it. */
  model: ModelClient;
  /** Throws the 429 HttpError if any model call in this request was denied. */
  assertAllowed(): void;
}

/**
 * Wraps the endpoint's model client so every call is charged to this request's buckets first.
 * A denied call is not made: it fails like a model outage inside the endpoint (whose fallback
 * answer is then discarded), and assertAllowed() turns the denial into the 429. Any limiter
 * failure (no service key, network, RPC error, timeout) is logged and the call goes through.
 */
export function guardModel(req: Request, endpoint: Endpoint, inner: ModelClient, deps: RateLimitDeps = {}): RateLimitGuard {
  const config = deps.config ?? loadRateLimitConfig();
  const store = deps.store === undefined ? storeFromEnv() : deps.store;
  let buckets: Promise<Bucket[]> | null = null;
  let denied: { scope: LimitScope; retryAfter: number } | null = null;
  let warned = false;

  async function charge(weight: number): Promise<void> {
    if (!config.enabled) return;
    if (denied) throw new ModelError("rate_limited", "AI budget used up for now", 429);
    if (!store) {
      if (!warned) console.error("[rate-limit] no counter store (SUPABASE_SERVICE_ROLE_KEY missing); allowing calls");
      warned = true;
      return;
    }
    let decision: Decision;
    try {
      buckets ??= bucketsFor(req, endpoint, config);
      decision = await store.take(await buckets, weight);
    } catch (err) {
      console.error(`[rate-limit] ${endpoint}: limiter unavailable, allowing call:`, err instanceof Error ? err.message : typeof err);
      return;
    }
    if (!decision.allowed) {
      denied = { scope: decision.scope, retryAfter: decision.retryAfter };
      console.log(`[rate-limit] ${endpoint}: denied ${weight} units (${decision.scope}, retry in ${decision.retryAfter}s)`);
      throw new ModelError("rate_limited", "AI budget used up for now", 429);
    }
  }

  if (config.enabled && !config.ipSalt) console.warn("[rate-limit] RATE_LIMIT_IP_SALT is not set; per-network limits are off");

  const model: ModelClient = {
    model: inner.model,
    keyPresent: inner.keyPresent,
    async generate<T>(opts: GenerateOptions<T>): Promise<T> {
      await charge(callWeight(opts.system.length + opts.user.length));
      return inner.generate(opts);
    },
    async ping(): Promise<void> {
      await charge(1);
      return inner.ping();
    },
  };

  return {
    model,
    assertAllowed() {
      if (denied) throw rateLimitedError(denied.scope, denied.retryAfter);
    },
  };
}

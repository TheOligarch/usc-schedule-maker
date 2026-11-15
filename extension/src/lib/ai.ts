/**
 * AI SEAM - every AI call in the app goes through this file.
 *
 * With USE_MOCKS (see config.ts) the scripted mocks in src/mocks/mockAi.ts answer.
 * Otherwise the Supabase Edge Functions from the shared contract are called with the
 * anon key. `offline: true` forces the built-in mock for one call, which the UI offers
 * when the AI service is unreachable.
 *
 * Every call carries the anonymous install ID (lib/installId.ts) for the functions' rate limits.
 * An HTTP 429 becomes an AiRateLimitError with a friendly wait message, and further calls to that
 * function (or to all of them, for the global breaker) fail fast locally until the wait is over.
 */
import { withElectiveInterests } from "./electiveInterests";
import { FUNCTIONS_BASE, SUPABASE_ANON_KEY, USE_MOCKS } from "./config";
import { AiError, AiRateLimitError, type LimitScope } from "./aiErrors";
import { getInstallId } from "./installId";
import type { AiHealth, ExplainRequest, ExplainResponse, InterviewRequest, InterviewResponse, RefineRequest, RefineResponse, TermData } from "./contract-types";
import { mockExplain, mockInterview } from "../mocks/mockAi";
import { normalizeClockTimes } from "../../../supabase/functions/_shared/clock";

export { AiError, AiRateLimitError };

/** Header the functions count requests by; see supabase/functions/_shared/rate-limit.ts. */
export const INSTALL_ID_HEADER = "x-usm-install-id";

/** Where an answer came from: the model, the function's own rule-based fallback, or the local mock. */
export type AiSource = "ai" | "fallback" | "mock";

export interface AiCallOptions {
  offline?: boolean;
  signal?: AbortSignal;
}

export const AI_IS_MOCK = USE_MOCKS;

/** Pauses after a 429, per function name; "*" is the global breaker and pauses every function. */
const pauses = new Map<string, { until: number; scope: LimitScope }>();
const ALL = "*";

function activePause(name: string): AiRateLimitError | null {
  const now = Date.now();
  let best: { until: number; scope: LimitScope } | null = null;
  for (const key of [name, ALL]) {
    const p = pauses.get(key);
    if (p && p.until > now && (!best || p.until > best.until)) best = p;
  }
  return best ? new AiRateLimitError(best.scope, Math.ceil((best.until - now) / 1000)) : null;
}

/** Tests only: forget every pause. */
export function resetAiPauses(): void {
  pauses.clear();
}

/** Reads a 429: the body's { scope, retryAfterSeconds } first, then the Retry-After header. */
async function rateLimitFrom(res: Response): Promise<AiRateLimitError> {
  const body = (await res.json().catch(() => null)) as { error?: { details?: { scope?: unknown; retryAfterSeconds?: unknown } } } | null;
  const details = body?.error?.details;
  const scope: LimitScope = details?.scope === "global" || details?.scope === "network" ? details.scope : "user";
  const fromBody = typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds : NaN;
  const fromHeader = Number(res.headers.get("retry-after"));
  const seconds = [fromBody, fromHeader].find((n) => Number.isFinite(n) && n > 0) ?? 60;
  return new AiRateLimitError(scope, Math.min(Math.ceil(seconds), 2 * 86400));
}

async function installIdHeader(): Promise<Record<string, string>> {
  try {
    return { [INSTALL_ID_HEADER]: await getInstallId() };
  } catch {
    return {};
  }
}

async function callFunction<T>(name: string, method: "GET" | "POST", body: unknown, signal?: AbortSignal): Promise<{ body: T; source: AiSource }> {
  if (!SUPABASE_ANON_KEY) throw new AiError("This build has no Supabase anon key (VITE_SUPABASE_ANON_KEY), so the AI service cannot be reached.");
  const paused = activePause(name);
  if (paused) throw paused;
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method,
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        ...(await installIdHeader()),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AiError("Could not reach the AI service. Check your connection and try again.");
  }
  if (res.status === 429) {
    const limited = await rateLimitFrom(res);
    pauses.set(limited.scope === "global" ? ALL : name, { until: Date.now() + limited.retryAfterSeconds * 1000, scope: limited.scope });
    throw limited;
  }
  if (!res.ok) throw new AiError(`The AI service returned an error (HTTP ${res.status}).`);
  const source: AiSource = res.headers.get("x-usm-ai-source") === "fallback" ? "fallback" : "ai";
  try {
    return { body: (await res.json()) as T, source };
  } catch {
    throw new AiError("The AI service returned a response that could not be read.");
  }
}

function checkInterview(res: InterviewResponse): InterviewResponse {
  const ok =
    res &&
    typeof res === "object" &&
    (res.done === false
      ? typeof res.question?.id === "string" && typeof res.question?.text === "string" && Array.isArray(res.question?.options)
      : res.done === true && typeof res.preferences === "object" && Array.isArray(res.shortlists) && Array.isArray(res.summary));
  if (!ok) throw new AiError("The AI service returned an unexpected interview response.");
  return withClockTimes(res);
}

/** Model text is shown to the student as-is, so rewrite any 24-hour time it slipped in. */
function withClockTimes(res: InterviewResponse): InterviewResponse {
  if (res.done === false) return res;
  const notes = res.preferences.notes;
  return {
    ...res,
    preferences: { ...res.preferences, notes: typeof notes === "string" ? normalizeClockTimes(notes) : notes },
    summary: res.summary.map((s) => (typeof s === "string" ? normalizeClockTimes(s) : s)),
  };
}

/** One stateless interview turn: send the whole history, get the next question or the conclusions. */
export async function interviewTurn(req: InterviewRequest, termData: TermData, opts: AiCallOptions = {}): Promise<{ res: InterviewResponse; source: AiSource }> {
  if (USE_MOCKS || opts.offline) return { res: withElectiveInterests(req, await mockInterview(req, termData), termData), source: "mock" };
  const { body, source } = await callFunction<InterviewResponse>("interview", "POST", req, opts.signal);
  return { res: withElectiveInterests(req, checkInterview(body), termData), source };
}

/** 1-2 sentence explanations for the top (<= 10) schedules. */
export async function explainSchedules(req: ExplainRequest, opts: AiCallOptions = {}): Promise<ExplainResponse> {
  const trimmed: ExplainRequest = { ...req, schedules: req.schedules.slice(0, 10) };
  if (trimmed.schedules.length === 0) return { explanations: [] };
  if (USE_MOCKS || opts.offline) return mockExplain(trimmed);
  const { body } = await callFunction<ExplainResponse>("explain", "POST", trimmed, opts.signal);
  if (!body || !Array.isArray(body.explanations)) throw new AiError("The AI service returned an unexpected explanation response.");
  return { explanations: body.explanations.map((e) => (e && typeof e.text === "string" ? { ...e, text: normalizeClockTimes(e.text) } : e)) };
}

/**
 * Free-text schedule feedback the local parser could not fully account for. Throws AiError
 * when the service is unavailable (demo mode, no key, network, or the function's own fallback),
 * so the caller reports the text as not understood instead of guessing.
 */
export async function interpretFeedback(req: RefineRequest, opts: AiCallOptions = {}): Promise<RefineResponse> {
  if (USE_MOCKS || opts.offline) throw new AiError("The AI interpreter is not available in demo mode.");
  const { body, source } = await callFunction<RefineResponse>("refine", "POST", req, opts.signal);
  if (source === "fallback") throw new AiError("The AI interpreter is unavailable right now.");
  if (!body || !Array.isArray(body.constraints)) throw new AiError("The AI service returned an unexpected refinement response.");
  return { constraints: body.constraints, unparsed: typeof body.unparsed === "string" ? body.unparsed : null };
}

export async function aiHealth(): Promise<AiHealth> {
  if (USE_MOCKS) return { keyPresent: false, model: "mock", modelOk: true };
  return (await callFunction<AiHealth>("ai-health", "GET", undefined)).body;
}

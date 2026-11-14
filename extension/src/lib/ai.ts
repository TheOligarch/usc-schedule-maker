/**
 * AI SEAM - every AI call in the app goes through this file.
 *
 * With USE_MOCKS (see config.ts) the scripted mocks in src/mocks/mockAi.ts answer.
 * Otherwise the Supabase Edge Functions from the shared contract are called with the
 * anon key. `offline: true` forces the built-in mock for one call, which the UI offers
 * when the AI service is unreachable.
 */
import { FUNCTIONS_BASE, SUPABASE_ANON_KEY, USE_MOCKS } from "./config";
import type { AiHealth, ExplainRequest, ExplainResponse, InterviewRequest, InterviewResponse, TermData } from "./contract-types";
import { mockExplain, mockInterview } from "../mocks/mockAi";

export class AiError extends Error {}

/** Where an answer came from: the model, the function's own rule-based fallback, or the local mock. */
export type AiSource = "ai" | "fallback" | "mock";

export interface AiCallOptions {
  offline?: boolean;
  signal?: AbortSignal;
}

export const AI_IS_MOCK = USE_MOCKS;

async function callFunction<T>(name: string, method: "GET" | "POST", body: unknown, signal?: AbortSignal): Promise<{ body: T; source: AiSource }> {
  if (!SUPABASE_ANON_KEY) throw new AiError("This build has no Supabase anon key (VITE_SUPABASE_ANON_KEY), so the AI service cannot be reached.");
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method,
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AiError("Could not reach the AI service. Check your connection and try again.");
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
  return res;
}

/** One stateless interview turn: send the whole history, get the next question or the conclusions. */
export async function interviewTurn(req: InterviewRequest, termData: TermData, opts: AiCallOptions = {}): Promise<{ res: InterviewResponse; source: AiSource }> {
  if (USE_MOCKS || opts.offline) return { res: await mockInterview(req, termData), source: "mock" };
  const { body, source } = await callFunction<InterviewResponse>("interview", "POST", req, opts.signal);
  return { res: checkInterview(body), source };
}

/** 1-2 sentence explanations for the top (<= 10) schedules. */
export async function explainSchedules(req: ExplainRequest, opts: AiCallOptions = {}): Promise<ExplainResponse> {
  const trimmed: ExplainRequest = { ...req, schedules: req.schedules.slice(0, 10) };
  if (trimmed.schedules.length === 0) return { explanations: [] };
  if (USE_MOCKS || opts.offline) return mockExplain(trimmed);
  const { body } = await callFunction<ExplainResponse>("explain", "POST", trimmed, opts.signal);
  if (!body || !Array.isArray(body.explanations)) throw new AiError("The AI service returned an unexpected explanation response.");
  return body;
}

export async function aiHealth(): Promise<AiHealth> {
  if (USE_MOCKS) return { keyPresent: false, model: "mock", modelOk: true };
  return (await callFunction<AiHealth>("ai-health", "GET", undefined)).body;
}

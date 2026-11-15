/**
 * Step 4 feedback is applied only when it leaves at least one schedule: the candidate
 * refinement is tried with the real engine first, and a conflict is explained by course,
 * pin or earlier feedback instead of replacing the schedules on screen.
 */
import { interpretFeedback } from "./ai";
import type { RankedSchedule, RefineRequest, TermData } from "./contract-types";
import { generateSchedules } from "./engine";
import { compileRefinements, describe, interpretRefinement, RefinementError, suggestRefinements, violatingSections, type AiInterpreter, type ParseContext, type Refinement } from "./refinement";
import { displayString } from "./schedule";
import { courseCombos, courseSections } from "./sectionPins";
import { fmtMeeting } from "./time";
import { buildRequest, type AppState } from "../state";

export function requestCodes(state: AppState, data: TermData): string[] {
  const req = buildRequest({ ...state, refinements: [] }, data);
  return [...new Set([...req.required, ...req.flexSlots.flatMap((f) => f.options)])];
}

/** The AI interpreter, given the student's courses as context. */
export function aiInterpreter(signal?: AbortSignal): AiInterpreter {
  return async (text: string, ctx: ParseContext) => {
    const req: RefineRequest = {
      text,
      courses: ctx.codes.slice(0, 12).map((code) => ({
        code,
        title: ctx.data.courses[code]?.title ?? code,
        sections: courseSections(ctx.data, code).slice(0, 60).map((s) => ({
          id: s.id,
          type: s.type,
          meetings: s.meetings.map((m) => fmtMeeting(m)),
          instructors: s.instructors.map((i) => `${i.first} ${i.last}`.trim()),
        })),
      })),
      schedule: ctx.schedule ? displayString(ctx.data, ctx.schedule) : null,
    };
    // An AiError (unavailable) falls back to the local reading or a "not understood" message.
    return interpretFeedback(req, { signal });
  };
}

export type CheckResult = { ok: true; refinement: Refinement; count: number } | { ok: false; refinement: Refinement; message: string; reasons: string[] };

/**
 * Interprets the text and dry-runs the engine with it; never changes state itself.
 * Only offered while the current rules produce schedules (the refine box is hidden otherwise),
 * so a zero result is caused by this change together with the current rules.
 */
export async function proposeRefinement(text: string, data: TermData, state: AppState, schedule: RankedSchedule | null, opts: { ai?: AiInterpreter | null; signal?: AbortSignal } = {}): Promise<CheckResult> {
  const ctx: ParseContext = { data, codes: requestCodes(state, data), schedule };
  const refinement = await interpretRefinement(text, ctx, opts.ai === undefined ? aiInterpreter(opts.signal) : opts.ai);
  const run = await dryRun(data, state, refinement, { signal: opts.signal });
  if (run.result.totalValid > 0) return { ok: true, refinement, count: run.result.totalValid };
  const reasons = await conflictReasons(data, state, refinement, run.result.blockers.map((b) => b.message), opts.signal);
  return {
    ok: false,
    refinement,
    reasons,
    message: `Not applied: “${refinement.summary}” would leave no schedule that fits your required courses. Your current schedules and earlier feedback are unchanged.`,
  };
}

/** The engine run for the current rules plus one more refinement; the apply-time and suggestion check. */
function dryRun(data: TermData, state: AppState, refinement: Refinement, opts: { signal?: AbortSignal; diagnostics?: boolean } = {}) {
  const next = { ...state, refinements: [...state.refinements, refinement] };
  return generateSchedules(data, buildRequest(next, data), { limit: 1, ...opts });
}

/** Feasibility of a suggestion, per term data, then request (requirements, pins, preferences, feedback) and text. */
const suggestionCache = new WeakMap<TermData, Map<string, boolean>>();
const CACHE_LIMIT = 500;

async function suggestionFits(text: string, ctx: ParseContext, state: AppState, signal?: AbortSignal): Promise<boolean> {
  let refinement: Refinement;
  try {
    refinement = await interpretRefinement(text, ctx, null);
  } catch (err) {
    if (err instanceof RefinementError) return false;
    throw err;
  }
  const run = await dryRun(ctx.data, state, refinement, { signal, diagnostics: false });
  return run.result.totalValid > 0;
}

/**
 * The suggestions inferred from the schedule on screen that would still leave at least one
 * schedule if applied, checked with the same dry run as applying typed feedback. Results are
 * cached per request and text, so revisiting a schedule or state costs no engine runs.
 */
export async function feasibleSuggestions(data: TermData, state: AppState, schedule: RankedSchedule | null, opts: { signal?: AbortSignal; max?: number } = {}): Promise<string[]> {
  const max = opts.max ?? 3;
  const candidates = suggestRefinements(data, schedule, Infinity);
  if (!candidates.length) return [];
  const ctx: ParseContext = { data, codes: requestCodes(state, data), schedule };
  const requestKey = JSON.stringify(buildRequest(state, data));
  let cache = suggestionCache.get(data);
  if (!cache) suggestionCache.set(data, (cache = new Map()));
  const out: string[] = [];
  for (const text of candidates) {
    if (out.length >= max) break;
    const key = `${requestKey}\u0000${text}`;
    let ok = cache.get(key);
    if (ok === undefined) {
      ok = await suggestionFits(text, ctx, state, opts.signal);
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(key, ok);
    }
    if (ok) out.push(text);
  }
  return out;
}

async function conflictReasons(data: TermData, state: AppState, ref: Refinement, blockers: string[], signal?: AbortSignal): Promise<string[]> {
  const reasons: string[] = [];
  const codes = requestCodes(state, data);
  const prior = new Set(compileRefinements(state.refinements, data, codes).excludedSectionIds);
  const sectionsOf = (code: string) => courseSections(data, code);
  const req = buildRequest(state, data);

  const earlier = state.refinements.map((r) => `“${r.summary}”`).join(", ");
  const killers = (code: string, pins: string[]) => {
    const pinned = courseCombos(data, code).filter((c) => pins.every((id) => c.includes(id)));
    const combos = pinned.filter((c) => !c.some((id) => prior.has(id)));
    if (!combos.length) return null;
    const out: string[] = [];
    for (const c of ref.constraints.filter((c) => c.hard)) {
      const bad = new Set(violatingSections(c, sectionsOf(code)).map((s) => s.id));
      if (!combos.every((combo) => combo.some((id) => bad.has(id)))) continue;
      const hit = pins.filter((id) => bad.has(id));
      if (hit.length) out.push(`Your pinned ${code} section ${hit.join(", ")} breaks “${describe(c)}”.`);
      else if (pinned.some((combo) => !combo.some((id) => bad.has(id)))) out.push(`For ${code}, it conflicts with your earlier feedback ${earlier}: no section combination satisfies both. Remove that feedback first if you want this change instead.`);
      else out.push(`Every ${code} section combination breaks “${describe(c)}”.`);
    }
    return out;
  };
  for (const code of req.required) {
    const pins = state.sectionPins[code] ?? [];
    const k = killers(code, pins);
    if (k) reasons.push(...k);
  }
  for (const slot of req.flexSlots) {
    if (!slot.options.length) continue;
    const per = slot.options.map((code) => killers(code, []));
    if (per.every((k) => k && k.length)) reasons.push(`No course in your “${slot.label}” slot can satisfy “${ref.summary}”.`);
  }
  if (!reasons.length && state.refinements.length) {
    const alone = await generateSchedules(data, buildRequest({ ...state, refinements: [ref] }, data), { limit: 1, diagnostics: false, signal });
    if (alone.result.totalValid > 0) reasons.push(`It conflicts with your earlier feedback ${earlier}. Remove that feedback first if you want this change instead.`);
  }
  if (!reasons.length) {
    reasons.push(`Each course can satisfy it on its own, but not together with your other courses, times and pins.`);
    const useful = blockers.find((b) => /feedback/.test(b)) ?? blockers[0];
    if (useful) reasons.push(useful);
  }
  return reasons;
}

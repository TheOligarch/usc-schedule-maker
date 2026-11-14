import { computeBlockers } from "./blockers";
import { type Problem, buildBase, buildProblem } from "./prepare";
import { type Combo, scheduleCost } from "./score";
import { type Found, drain, search } from "./search";
import type { AsyncGenerateOptions, GenerateOptions, GenerateResult, Penalty, RankedSchedule, ScheduleRequest, TermData } from "./types";
import { DEFAULT_WEIGHTS, scaleWeights } from "./weights";

export * from "./types";
export { DEFAULT_WEIGHTS, IMPORTANCE_KEY, importanceFactor, type Weights } from "./weights";
export { linkCombos } from "./linkage";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
/** Enumeration stops after this many valid schedules (result.truncated = true). */
export const DEFAULT_MAX_ENUMERATE = 100_000;
/** Each blocker relaxation counts at most this many schedules. */
export const DIAGNOSTIC_CAP = 20_000;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function toRanked(p: Problem, f: Found, scoreScale: number): RankedSchedule {
  const levels = p.order.map((i) => p.reqs[i]);
  const chosen = levels.map((L, l) => ({ req: L, combo: L.combos[f.picks[l]], shared: f.shared[l] }));
  const distinct: Combo[] = chosen.filter((c) => !c.shared).map((c) => c.combo);

  const penalties: Penalty[] = [];
  const warnings: string[] = [];
  let units = 0;
  for (const c of distinct) {
    units += c.units;
    for (const pen of c.penalties) penalties.push({ ...pen });
    for (const w of c.warnings) if (!warnings.includes(w)) warnings.push(w);
  }
  scheduleCost(distinct, p.ctx, penalties);
  for (const c of chosen) {
    if (!c.shared) continue;
    const twin = chosen.find((o) => !o.shared && o.combo.key === c.combo.key);
    if (twin) warnings.push(`${c.combo.courseCode} and ${twin.combo.courseCode} are the same cross-listed class; it is counted once.`);
  }

  const courses = chosen
    .slice()
    .sort((a, b) => a.req.index - b.req.index)
    .map((c) => ({ courseCode: c.combo.courseCode, sectionIds: c.combo.sectionIds.slice() }));

  return {
    id: f.id,
    units,
    score: Math.round(((100 * scoreScale) / (scoreScale + Math.max(0, f.total))) * 10) / 10,
    courses,
    penalties,
    warnings,
  };
}

/**
 * The whole run as a step generator: yields periodically so the async
 * wrapper can give the event loop a turn. The sync API simply drains it.
 */
export function* generateSteps(data: TermData, req: ScheduleRequest, opts: GenerateOptions = {}): Generator<void, GenerateResult, void> {
  const limit = clampLimit(opts.limit);
  const maxEnumerate = Math.max(1, Math.floor(opts.maxEnumerate ?? DEFAULT_MAX_ENUMERATE));
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const w = scaleWeights(weights, req.importance);

  const base = buildBase(data, req, w);
  const problem = buildProblem(base);
  const res = yield* search(problem, { limit, cap: maxEnumerate });
  const schedules = res.best.map((f) => toRanked(problem, f, weights.scoreScale));

  let blockers: GenerateResult["blockers"] = [];
  if (opts.diagnostics !== false || res.count === 0) {
    // relaxation counts are only comparable to an exact base count
    if (!res.truncated && res.count < DIAGNOSTIC_CAP) blockers = yield* computeBlockers(base, problem, res.count, DIAGNOSTIC_CAP);
  }

  const result: GenerateResult = { totalValid: res.count, schedules, blockers };
  if (res.truncated) result.truncated = true;
  return result;
}

/**
 * Builds every schedule that satisfies the hard constraints and returns the
 * best `limit` (default 10, max 100), ranked by soft-preference fit.
 */
export function generateSchedules(data: TermData, req: ScheduleRequest, opts?: GenerateOptions): GenerateResult {
  return drain(generateSteps(data, req, opts));
}

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function abortError(): Error {
  const e = new Error("generateSchedulesAsync was aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Same result as generateSchedules, but hands control back to the event loop
 * every `sliceMs` (default 12ms) so the UI stays responsive. Supports
 * cancellation through `signal`.
 */
export async function generateSchedulesAsync(data: TermData, req: ScheduleRequest, opts: AsyncGenerateOptions = {}): Promise<GenerateResult> {
  const { signal, sliceMs = 12, ...rest } = opts;
  if (signal?.aborted) throw abortError();
  const gen = generateSteps(data, req, rest);
  let last = now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (now() - last >= sliceMs) {
      await yieldToLoop();
      if (signal?.aborted) throw abortError();
      last = now();
    }
  }
}

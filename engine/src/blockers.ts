import { type Base, type Problem, type Relax, buildProblem } from "./prepare";
import { type SearchResult, search } from "./search";
import { DAYS, fmtDays, fmtMinutes, toMinutes } from "./time";
import type { Block, Blocker, Day } from "./types";

function fmtCount(n: number, capped: boolean): string {
  const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${s}${capped ? "+" : ""} schedule${n === 1 && !capped ? "" : "s"}`;
}

function listCodes(codes: string[]): string {
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/** Days grouped by the same threshold: "before 10:00 on Mon/Wed and before 11:00 on Tue/Thu". */
function groupedByTime(byDay: Map<number, number>, word: string): string {
  const byTime = new Map<number, number[]>();
  for (const [d, t] of byDay) {
    const list = byTime.get(t);
    if (list) list.push(d);
    else byTime.set(t, [d]);
  }
  return [...byTime.entries()]
    .sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))
    .map(([t, ds]) => `${word} ${fmtMinutes(t)} on ${fmtDays(ds)}`)
    .join(" and ");
}

/**
 * Explains what is keeping schedules out: for each single constraint, how
 * many more schedules relaxing just that constraint would admit.
 * `baseCount` is the number of valid schedules with nothing relaxed; counts
 * stop at `cap` (shown as "N+").
 */
export function* computeBlockers(base: Base, baseProblem: Problem, baseCount: number, cap: number): Generator<void, Blocker[], void> {
  const out: Blocker[] = [];
  const structural: (Blocker & { reqIndex: number })[] = [];
  const reqs = baseProblem.reqs;
  const req = base.req;

  if (!reqs.length) {
    return [{ constraint: "requiredCourse", eliminated: 0, message: "Add at least one course or course slot to build schedules." }];
  }

  const count = function* (relax: Relax): Generator<void, SearchResult, void> {
    return yield* search(buildProblem(base, relax), { limit: 0, cap });
  };
  const gained = (r: SearchResult) => r.count - baseCount;
  const add = (constraint: string, r: SearchResult, message: (n: string) => string) => {
    const g = gained(r);
    if (g > 0) out.push({ constraint, eliminated: g, message: message(fmtCount(r.count, r.truncated)) });
  };

  // structural problems: unknown courses, no registrable combination, empty slots
  for (const r of reqs) {
    for (const code of r.unknown) {
      structural.push({ reqIndex: r.index, constraint: "unknownCourse", eliminated: 0, message: `${code} is not offered in ${base.data.term?.name ?? "this term"}.` });
    }
    for (const code of r.noLink) {
      structural.push({ reqIndex: r.index, constraint: "noValidLinkCombo", eliminated: 0, message: `${code} has no valid lecture/discussion/lab combination this term.` });
    }
    if (r.kind === "flex" && !r.codes.length) {
      structural.push({ reqIndex: r.index, constraint: "flexSlot", eliminated: 0, message: `The slot "${r.label}" has no course options.` });
    }
  }

  // --- allowed times -------------------------------------------------------
  const allowed = req.allowedTimes ?? ({} as Record<Day, Block[]>);
  const dayBlocks = DAYS.map((d) =>
    (allowed[d] ?? [])
      .map((b) => ({ s: toMinutes(b.start), e: toMinutes(b.end) }))
      .filter((b) => !Number.isNaN(b.s) && !Number.isNaN(b.e) && b.e > b.s)
      .sort((a, b) => a.s - b.s),
  );
  const slots = new Map<string, { day: number; s: number; e: number }>();
  for (const r of reqs) for (const c of r.structural) for (const sl of c.slots) slots.set(`${sl.day}:${sl.s}:${sl.e}`, sl);

  const early = new Map<number, number>();
  const late = new Map<number, number>();
  const gapDays = new Set<number>();
  const offDays = new Set<number>();
  for (const sl of slots.values()) {
    const blocks = dayBlocks[sl.day];
    if (!blocks.length) {
      offDays.add(sl.day);
      continue;
    }
    const first = blocks[0].s;
    const last = Math.max(...blocks.map((b) => b.e));
    if (sl.s < first) early.set(sl.day, first);
    if (sl.e > last) late.set(sl.day, last);
    if (blocks.length > 1 && sl.s >= first && sl.e <= last && !blocks.some((b) => b.s <= sl.s && sl.e <= b.e)) gapDays.add(sl.day);
  }
  const withDays = (fn: (day: number, blocks: { s: number; e: number }[]) => { s: number; e: number }[] | null) => {
    const next = {} as Record<Day, Block[]>;
    DAYS.forEach((d, i) => {
      const changed = fn(i, dayBlocks[i]);
      next[d] = (changed ?? dayBlocks[i]).map((b) => ({ start: fmtMinutes(b.s), end: fmtMinutes(b.e) }));
    });
    return next;
  };
  let timeGain = false;
  if (early.size) {
    const r = yield* count({ allowedTimes: withDays((d, b) => (early.has(d) ? [{ s: 0, e: b[0].e }, ...b.slice(1)] : null)) });
    if (gained(r) > 0) timeGain = true;
    add("allowedTimes", r, (n) => `Allowing classes ${groupedByTime(early, "before")} would give ${n}.`);
  }
  if (late.size) {
    const r = yield* count({
      allowedTimes: withDays((d, b) => (late.has(d) ? [...b.slice(0, -1), { s: b[b.length - 1].s, e: 24 * 60 }] : null)),
    });
    if (gained(r) > 0) timeGain = true;
    add("allowedTimes", r, (n) => `Allowing classes ${groupedByTime(late, "after")} would give ${n}.`);
  }
  if (gapDays.size) {
    const r = yield* count({ allowedTimes: withDays((d, b) => (gapDays.has(d) ? [{ s: b[0].s, e: Math.max(...b.map((x) => x.e)) }] : null)) });
    if (gained(r) > 0) timeGain = true;
    add("allowedTimes", r, (n) => `Allowing classes in the gaps between your time blocks on ${fmtDays(gapDays)} would give ${n}.`);
  }
  for (const d of [...offDays].sort((a, b) => a - b)) {
    const r = yield* count({ allowedTimes: withDays((i) => (i === d ? [{ s: 0, e: 24 * 60 }] : null)) });
    if (gained(r) > 0) timeGain = true;
    add("allowedTimes", r, (n) => `Allowing classes on ${DAYS[d]} would give ${n}.`);
  }
  for (const r of reqs) {
    if (r.combos.length || !r.timeFails) continue;
    const res = yield* count({ ignoreTimesFor: r.index });
    if (gained(res) > 0) timeGain = true;
    const what = r.kind === "required" ? r.label : `every option for "${r.label}"`;
    add("allowedTimes", res, (n) => `Every section of ${what} meets outside your allowed times; allowing them would give ${n}.`);
  }
  if (!timeGain && (early.size || late.size || gapDays.size || offDays.size)) {
    const all = {} as Record<Day, Block[]>;
    for (const d of DAYS) all[d] = [{ start: "00:00", end: "24:00" }];
    const r = yield* count({ allowedTimes: all });
    add("allowedTimes", r, (n) => `Removing all of your time restrictions would give ${n}.`);
  }

  // --- unit cap --------------------------------------------------------------
  if (typeof req.unitCap === "number") {
    const r = yield* count({ noUnitCap: true });
    const smallest = Number.isFinite(r.minUnits) ? ` (the smallest is ${r.minUnits} units)` : "";
    add("unitCap", r, (n) => `Removing your ${req.unitCap}-unit cap would give ${n}${smallest}.`);
  }

  // --- minimum RMP -------------------------------------------------------------
  if (typeof req.minRmp === "number") {
    const r = yield* count({ noMinRmp: true });
    const wiped = reqs.filter((x) => !x.combos.length && x.rmpFails > 0).map((x) => x.label);
    const extra = wiped.length ? `; it rules out every section of ${listCodes(wiped)}` : "";
    add("minRmp", r, (n) => `Removing your minimum RateMyProfessor rating of ${req.minRmp} would give ${n}${extra}.`);
  }

  // --- time conflicts ------------------------------------------------------
  {
    const r = yield* count({ ignoreConflicts: true });
    const levels = baseProblem.order.map((i) => reqs[i]);
    const pairs: string[] = [];
    for (let j = 0; j < levels.length; j++) {
      for (let i = 0; i < j; i++) {
        const m = baseProblem.compat[j][i];
        if (m.length && m.every((v) => v === 0)) pairs.push(`${levels[i].label} and ${levels[j].label}`);
      }
    }
    const detail = pairs.length ? ` (${pairs.slice(0, 2).join("; ")} overlap in every section option)` : "";
    add("timeConflict", r, () => `Time conflicts between your courses rule out ${fmtCount(gained(r), r.truncated)}${detail}.`);
  }

  // --- dropping a requirement (only when nothing fits and no single
  // constraint relaxation helps; also sizes the structural blockers) -------
  if (baseCount === 0 && reqs.length > 1) {
    const drops: Blocker[] = [];
    for (const r of reqs) {
      const res = yield* count({ drop: r.index });
      const g = gained(res);
      if (g <= 0) continue;
      const mine = structural.filter((s) => s.reqIndex === r.index);
      for (const s of mine) s.eliminated = Math.max(s.eliminated, g);
      if (mine.length) continue;
      if (r.kind === "required") drops.push({ constraint: "requiredCourse", eliminated: g, message: `Dropping ${r.label} would give ${fmtCount(res.count, res.truncated)}.` });
      else drops.push({ constraint: "flexSlot", eliminated: g, message: `Leaving out the "${r.label}" slot would give ${fmtCount(res.count, res.truncated)}.` });
    }
    if (!out.length) out.push(...drops);
  }

  const all: Blocker[] = [...structural.map(({ reqIndex: _r, ...b }) => b), ...out];
  all.sort((a, b) => b.eliminated - a.eliminated);
  if (baseCount === 0 && !all.length) {
    all.push({
      constraint: "combination",
      eliminated: 0,
      message: "No single change produces a schedule; try relaxing more than one constraint (for example, widen your time blocks and remove the unit cap).",
    });
  }
  return all;
}

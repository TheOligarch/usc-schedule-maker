import { linkCombos } from "./linkage";
import { type Combo, type ScoreCtx, type Slot, buildScoreCtx, comboCost } from "./score";
import { DAYS, dayIndex, toMinutes } from "./time";
import type { Block, Course, Day, ScheduleRequest, Section, TermData } from "./types";
import type { ScaledWeights } from "./weights";

/** One thing the schedule must contain: a required course or a flex slot. */
export interface Requirement {
  /** position in the request: required courses first, then flex slots */
  index: number;
  kind: "required" | "flex";
  /** course code (required) or slot label (flex) */
  label: string;
  /** requested codes: one for required, the options for a flex slot */
  codes: string[];
  /** requested codes the term data does not know */
  unknown: string[];
  /** codes that exist but have no registrable section combination */
  noLink: string[];
  /** every linkage-valid combo, before hard filters */
  structural: Combo[];
  /** combos passing the hard per-course filters, best (lowest base) first */
  combos: Combo[];
  timeFails: number;
  overlapFails: number;
  /** union of covered codes over all combos */
  covered: Set<string>;
}

/** Relaxations used by the blocker diagnostics. */
export interface Relax {
  allowedTimes?: Record<Day, Block[]>;
  /** requirement index whose time check is skipped */
  ignoreTimesFor?: number;
  noUnitCap?: boolean;
  ignoreConflicts?: boolean;
  /** requirement index left out entirely */
  drop?: number;
}

export interface Problem {
  reqs: Requirement[];
  /** requirement indices in search order (fewest combos first) */
  order: number[];
  /** compat[j][i] for search levels i < j: Uint8Array(n_i * n_j); 0 = clash, 1 = ok, 2 = same class (shared) */
  compat: Uint8Array[][];
  /** smallest units each search level can add (0 when it may be shared) */
  minUnits: number[];
  unitCap: number | null;
  ctx: ScoreCtx;
}

interface Resolved {
  course: Course | null;
  sections: Section[];
}

/** Looks up course codes, honoring cross-listing. Built once per generate call. */
export class CourseIndex {
  private readonly bySectionCode = new Map<string, Section[]>();
  private readonly cache = new Map<string, Resolved | null>();

  constructor(
    private readonly data: TermData,
    codes: Iterable<string>,
  ) {
    const wanted = new Set(codes);
    for (const s of Object.values(data.sections ?? {})) {
      for (const c of s.courseCodes ?? []) {
        if (!wanted.has(c)) continue;
        const list = this.bySectionCode.get(c);
        if (list) list.push(s);
        else this.bySectionCode.set(c, [s]);
      }
    }
  }

  resolve(code: string): Resolved | null {
    if (this.cache.has(code)) return this.cache.get(code)!;
    const courses = this.data.courses ?? {};
    const sectionsMap = this.data.sections ?? {};
    let course: Course | null = courses[code] ?? null;
    const extra = this.bySectionCode.get(code) ?? [];
    if (!course) {
      // a cross-listed code that only appears on another course's sections
      for (const c of Object.values(courses)) {
        if (c.crossListedWith?.includes(code) || (extra.length && c.sectionIds?.includes(extra[0].id))) {
          course = c;
          break;
        }
      }
    }
    const seen = new Set<string>();
    const sections: Section[] = [];
    for (const id of course?.sectionIds ?? []) {
      const s = sectionsMap[id];
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        sections.push(s);
      }
    }
    for (const s of extra) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        sections.push(s);
      }
    }
    const out = course || sections.length ? { course, sections } : null;
    this.cache.set(code, out);
    return out;
  }
}

function slotsOf(s: Section): Slot[] {
  const out: Slot[] = [];
  for (const m of s.meetings ?? []) {
    const a = toMinutes(m.start);
    const b = toMinutes(m.end);
    if (Number.isNaN(a) || Number.isNaN(b)) continue; // unparseable time = TBA
    for (const d of m.days ?? []) {
      const i = dayIndex(d);
      if (i >= 0) out.push({ day: i, s: a, e: Math.max(a, b) });
    }
  }
  return out;
}

function allowedMinutes(allowed: Record<Day, Block[]> | undefined): { s: number; e: number }[][] {
  return DAYS.map((d) =>
    (allowed?.[d] ?? [])
      .map((b) => ({ s: toMinutes(b.start), e: toMinutes(b.end) }))
      .filter((b) => !Number.isNaN(b.s) && !Number.isNaN(b.e) && b.e > b.s),
  );
}

function fitsAllowed(slots: Slot[], allowed: { s: number; e: number }[][]): boolean {
  for (const sl of slots) {
    let ok = false;
    for (const b of allowed[sl.day]) {
      if (b.s <= sl.s && sl.e <= b.e) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

function overlaps(a: Slot[], b: Slot[]): boolean {
  for (const x of a) for (const y of b) if (x.day === y.day && x.s < y.e && y.s < x.e) return true;
  return false;
}

function finalOf(sections: Section[]) {
  for (const s of sections) {
    if (!s.final) continue;
    const a = toMinutes(s.final.start);
    const b = toMinutes(s.final.end);
    if (s.final.date && !Number.isNaN(a) && !Number.isNaN(b)) return { date: s.final.date, s: a, e: b };
  }
  return null;
}

function buildCombos(
  code: string,
  resolved: Resolved,
  data: TermData,
  w: ScaledWeights,
  slotCache: Map<string, Slot[]>,
): Combo[] {
  const { course, sections } = resolved;
  const link = linkCombos(course, sections);
  const baseCovered = new Set<string>([code]);
  if (course) {
    baseCovered.add(course.code);
    for (const c of course.crossListedWith ?? []) baseCovered.add(c);
  }
  const combos: Combo[] = [];
  const seenKeys = new Set<string>();
  for (const secs of link.combos) {
    const ids = secs.map((s) => s.id);
    const key = [...ids].sort().join("+");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const covered = new Set(baseCovered);
    const perSection: Slot[][] = [];
    const slots: Slot[] = [];
    let dayMask = 0;
    for (const s of secs) {
      for (const c of s.courseCodes ?? []) covered.add(c);
      let sl = slotCache.get(s.id);
      if (!sl) {
        sl = slotsOf(s);
        slotCache.set(s.id, sl);
      }
      perSection.push(sl);
      for (const x of sl) {
        slots.push(x);
        dayMask |= 1 << x.day;
      }
    }
    let selfOverlap = false;
    for (let i = 0; i < perSection.length && !selfOverlap; i++)
      for (let j = i + 1; j < perSection.length && !selfOverlap; j++) if (overlaps(perSection[i], perSection[j])) selfOverlap = true;

    const lecture = secs.find((s) => s.type.startsWith("LEC")) ?? secs[0];
    const units = course ? course.units.min : lecture.units?.min ?? 0;
    const cost = comboCost({ code, course, sections: secs, ambiguous: link.ambiguous, rmp: data.rmp ?? {}, w });

    combos.push({
      courseCode: code,
      sections: secs,
      sectionIds: ids,
      key,
      slots,
      dayMask,
      units: Number.isFinite(units) ? units : 0,
      covered,
      base: cost.base,
      penalties: cost.penalties,
      warnings: cost.warnings,
      final: finalOf(secs),
      timeOk: true,
      selfOverlap,
    });
  }
  return combos;
}

/** Linkage-valid combos per requirement; independent of hard filters, so built once and reused by relaxations. */
export interface Base {
  data: TermData;
  req: ScheduleRequest;
  w: ScaledWeights;
  ctx: ScoreCtx;
  reqs: Omit<Requirement, "combos" | "timeFails" | "overlapFails">[];
}

export function buildBase(data: TermData, req: ScheduleRequest, w: ScaledWeights): Base {
  const required = [...new Set((req.required ?? []).filter((c) => typeof c === "string" && c))];
  const flex = (req.flexSlots ?? []).map((f, i) => ({
    label: f.label || `Slot ${i + 1}`,
    options: [...new Set((f.options ?? []).filter((c) => typeof c === "string" && c))],
  }));
  const index = new CourseIndex(data, [...required, ...flex.flatMap((f) => f.options)]);
  const slotCache = new Map<string, Slot[]>();
  const reqs: Base["reqs"] = [];

  const make = (kind: "required" | "flex", label: string, codes: string[]) => {
    const unknown: string[] = [];
    const noLink: string[] = [];
    const structural: Combo[] = [];
    for (const code of codes) {
      const r = index.resolve(code);
      if (!r) {
        unknown.push(code);
        continue;
      }
      const pin = req.sectionPins?.[code];
      const excluded = new Set(req.excludedSectionIds ?? []);
      const cs = buildCombos(code, r, data, w, slotCache).filter(c =>
        (!pin || c.sectionIds.includes(pin)) && !c.sectionIds.some(id => excluded.has(id)));
      const interest = req.courseInterestScores?.[code];
      if (kind === "flex" && typeof interest === "number" && Number.isFinite(interest)) {
        const amount = (1 - Math.max(0, Math.min(1, interest))) * 8;
        for (const c of cs) {
          c.base += amount;
          if (amount) c.penalties.push({ kind: "preference", amount, message: `${code}: a weaker match for your selected elective interests.` });
        }
      }
      if (!cs.length) noLink.push(code);
      structural.push(...cs);
    }
    const covered = new Set<string>();
    for (const c of structural) for (const x of c.covered) covered.add(x);
    reqs.push({ index: reqs.length, kind, label, codes, unknown, noLink, structural, covered });
  };
  for (const code of required) make("required", code, [code]);
  for (const f of flex) make("flex", f.label, f.options);

  return { data, req, w, ctx: buildScoreCtx(req, w), reqs };
}

/** Applies hard filters (optionally relaxed) and builds the search problem. */
export function buildProblem(base: Base, relax: Relax = {}): Problem {
  const allowed = allowedMinutes(relax.allowedTimes ?? base.req.allowedTimes);
  const reqs: Requirement[] = [];
  for (const r of base.reqs) {
    if (relax.drop === r.index) continue;
    const ignoreTimes = relax.ignoreTimesFor === r.index;
    let timeFails = 0;
    let overlapFails = 0;
    const combos: Combo[] = [];
    for (const c of r.structural) {
      if (c.selfOverlap && !relax.ignoreConflicts) {
        overlapFails++;
        continue;
      }
      if (!ignoreTimes && !fitsAllowed(c.slots, allowed)) {
        timeFails++;
        continue;
      }
      combos.push(c);
    }
    // best first so good schedules are found early (stable for equal cost)
    combos.sort((a, b) => a.base - b.base);
    reqs.push({ ...r, combos, timeFails, overlapFails });
  }

  const order = reqs.map((_, i) => i).sort((a, b) => reqs[a].combos.length - reqs[b].combos.length || a - b);
  const levels = order.map((i) => reqs[i]);
  const compat: Uint8Array[][] = levels.map(() => []);
  for (let j = 0; j < levels.length; j++) {
    const B = levels[j];
    for (let i = 0; i < j; i++) {
      const A = levels[i];
      const m = new Uint8Array(A.combos.length * B.combos.length);
      let codesMayClash = false;
      for (const x of A.covered) if (B.covered.has(x)) codesMayClash = true;
      const bothRequired = A.kind === "required" && B.kind === "required";
      for (let a = 0; a < A.combos.length; a++) {
        const ca = A.combos[a];
        for (let b = 0; b < B.combos.length; b++) {
          const cb = B.combos[b];
          let v = 1;
          if (codesMayClash && [...cb.covered].some((x) => ca.covered.has(x))) {
            // the same class listed under two requested codes
            v = bothRequired && ca.key === cb.key ? 2 : 0;
          } else if (!relax.ignoreConflicts && ca.dayMask & cb.dayMask && overlaps(ca.slots, cb.slots)) {
            v = 0;
          }
          m[a * B.combos.length + b] = v;
        }
      }
      compat[j][i] = m;
    }
  }

  const minUnits = levels.map((L, j) => {
    let shareable = false;
    if (L.kind === "required") {
      for (let i = 0; i < levels.length; i++) {
        if (i === j || levels[i].kind !== "required") continue;
        for (const x of levels[i].covered) if (L.covered.has(x)) shareable = true;
      }
    }
    if (shareable || !L.combos.length) return 0;
    return Math.min(...L.combos.map((c) => c.units));
  });

  const cap = relax.noUnitCap ? null : base.req.unitCap;
  return {
    reqs,
    order,
    compat,
    minUnits,
    unitCap: typeof cap === "number" && Number.isFinite(cap) ? cap : null,
    ctx: base.ctx,
  };
}

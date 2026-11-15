import { isLecture } from "./linkage";
import { DAYS, WEEKDAYS, dayIndex, fmtClock, fmtDays, toMinutes } from "./time";
import type { Course, Day, Penalty, RmpTeacher, ScheduleRequest, Section } from "./types";
import type { ScaledWeights } from "./weights";

export interface Slot {
  day: number;
  s: number;
  e: number;
}

export interface FinalExam {
  date: string;
  s: number;
  e: number;
}

/** A registrable set of sections for one course, with its precomputed costs. */
export interface Combo {
  /** the requested code this combo satisfies */
  courseCode: string;
  sections: Section[];
  sectionIds: string[];
  /** sorted section ids joined by "+" (identity of the combo) */
  key: string;
  slots: Slot[];
  dayMask: number;
  units: number;
  /** every course code these sections stand for (cross-listing) */
  covered: Set<string>;
  /** sum of section-level penalty amounts */
  base: number;
  penalties: Penalty[];
  warnings: string[];
  final: FinalExam | null;
  /** hard-filter flags */
  timeOk: boolean;
  selfOverlap: boolean;
}

export interface ScoreCtx {
  w: ScaledWeights;
  daySpread: ScheduleRequest["preferences"]["daySpread"];
  breaks: ScheduleRequest["preferences"]["breaks"];
  maxGap: number | null;
  preferredOffMask: number;
  /** weekdays the student could have class on (for "spread") */
  spreadTarget: number;
  comfortStart: number;
  comfortEnd: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildScoreCtx(req: ScheduleRequest, w: ScaledWeights): ScoreCtx {
  const p = req.preferences ?? ({} as ScheduleRequest["preferences"]);
  let preferredOffMask = 0;
  for (const d of p.preferredDaysOff ?? []) {
    const i = dayIndex(d);
    if (i >= 0) preferredOffMask |= 1 << i;
  }
  let spreadTarget = 0;
  for (const d of WEEKDAYS) {
    const blocks = req.allowedTimes?.[d] ?? [];
    if (blocks.length && !(preferredOffMask & (1 << dayIndex(d)))) spreadTarget++;
  }
  const cs = toMinutes(p.comfortStart);
  const ce = toMinutes(p.comfortEnd);
  return {
    w,
    daySpread: p.daySpread ?? "neutral",
    breaks: p.breaks ?? "neutral",
    maxGap: typeof p.maxGapMinutes === "number" && p.maxGapMinutes >= 0 ? p.maxGapMinutes : null,
    preferredOffMask,
    spreadTarget,
    comfortStart: Number.isNaN(cs) ? -1 : cs,
    comfortEnd: Number.isNaN(ce) ? -1 : ce,
  };
}

// ---------------------------------------------------------------------------
// Section-level (per combo) penalties
// ---------------------------------------------------------------------------

function seatState(s: Section): "waitlist" | "full" | null {
  const { registered, total } = s.seats ?? { registered: 0, total: 0 };
  const waitNote = !!s.notes && /wait\s*-?\s*list/i.test(s.notes);
  if (total > 0 && registered > total) return "waitlist";
  if (s.isFull || (total > 0 && registered >= total)) return waitNote ? "waitlist" : "full";
  return null;
}

const OFF_CAMPUS = /\bHSC\b|health\s*sci|off[-\s]?campus/i;

function sectionLabel(code: string, s: Section): string {
  return `${code} ${s.type} ${s.id}`;
}

export interface ComboCostInput {
  code: string;
  course: Course | null;
  sections: Section[];
  ambiguous: boolean;
  rmp: Record<string, RmpTeacher>;
  w: ScaledWeights;
}

export interface ComboCost {
  base: number;
  penalties: Penalty[];
  warnings: string[];
}

export function comboCost(inp: ComboCostInput): ComboCost {
  const { code, course, sections, w } = inp;
  const penalties: Penalty[] = [];
  const warnings: string[] = [];
  const add = (p: Penalty) => {
    p.amount = round2(p.amount);
    if (p.amount > 0) penalties.push(p);
  };

  for (const s of sections) {
    const seat = seatState(s);
    if (seat === "waitlist") {
      add({ kind: "waitlist", sectionId: s.id, amount: w.waitlist, message: `${sectionLabel(code, s)} is full with a waitlist` });
    } else if (seat === "full") {
      add({ kind: "full", sectionId: s.id, amount: w.full, message: `${sectionLabel(code, s)} is full` });
    }
    if (s.dClearance) {
      add({ kind: "dClearance", sectionId: s.id, amount: w.dClearance, message: `${sectionLabel(code, s)} requires D-clearance` });
    }
  }

  // online / TBA / off-campus: once per course
  const online = sections.find((s) => s.online);
  const tba = sections.find((s) => !s.meetings?.length || s.meetings.every((m) => !m.days?.length));
  const offCampus = sections.find((s) => s.campus != null && OFF_CAMPUS.test(s.campus));
  if (online) {
    add({ kind: "onlineOrTba", sectionId: online.id, amount: w.onlineOrTba, message: `${code} section ${online.id} is online` });
  } else if (tba) {
    add({ kind: "onlineOrTba", sectionId: tba.id, amount: w.onlineOrTba, message: `${code} section ${tba.id} has TBA meeting times` });
  } else if (offCampus) {
    add({ kind: "onlineOrTba", sectionId: offCampus.id, amount: w.offCampus, message: `${code} section ${offCampus.id} meets at ${offCampus.campus}` });
  }

  const lectures = sections.filter(isLecture);
  const primary = lectures.length ? lectures : sections.slice(0, 1);

  if (inp.ambiguous) {
    const lec = primary[0];
    add({ kind: "ambiguousLink", sectionId: lec?.id, amount: w.ambiguousLink, message: `${code}: lecture/discussion pairing is a guess from section order` });
    warnings.push(`${code}: the lecture/discussion pairing for section ${lec?.id} was guessed from section order; confirm it on WebReg before registering.`);
  }

  // RMP: lecture instructors only
  for (const lec of primary) {
    const rated: { name: string; avg: number }[] = [];
    let reason = lec.instructors?.length ? "has no RateMyProfessor rating" : "has no instructor listed";
    for (const ins of lec.instructors ?? []) {
      const name = `${ins.first} ${ins.last}`.trim();
      const t = ins.rmpId ? inp.rmp[ins.rmpId] : undefined;
      if (!t) continue;
      if (!(t.count >= w.rmpMinRatings) || !Number.isFinite(t.avg)) {
        reason = `instructor ${name} has only ${t.count} RateMyProfessor rating${t.count === 1 ? "" : "s"}`;
        continue;
      }
      rated.push({ name, avg: t.avg });
      if (ins.rmpMatch === "initial") {
        warnings.push(`${code}: RateMyProfessor rating for ${name} is a possible match (matched by first initial and last name).`);
      }
    }
    if (!rated.length) {
      add({ kind: "noRmp", sectionId: lec.id, amount: w.noRmp, message: `${code} lecture ${lec.id} ${reason}` });
      continue;
    }
    const worst = rated.reduce((a, b) => (b.avg < a.avg ? b : a));
    const q = (5 - Math.min(5, Math.max(0, worst.avg))) * w.rmpQualityPerPoint;
    add({ kind: "preference", sectionId: lec.id, amount: q, message: `${code} lecture instructor ${worst.name} is rated ${worst.avg.toFixed(1)}/5` });
  }

  if (course?.prereqText) warnings.push(`${code}: ${course.prereqText}`);
  if (course && course.units.max > course.units.min) {
    warnings.push(`${code} is variable units (${course.units.min}-${course.units.max}); ${course.units.min} counted toward your unit cap.`);
  }

  let base = 0;
  for (const p of penalties) base += p.amount;
  return { base, penalties, warnings };
}

// ---------------------------------------------------------------------------
// Schedule-level penalties (need the whole week)
// ---------------------------------------------------------------------------

const dayBuf: Slot[][] = [[], [], [], [], [], [], []];

/**
 * Penalties that depend on the whole schedule: final-exam conflicts, day
 * spread, gaps, preferred days off, comfort times. Returns the total amount;
 * when `out` is given also appends itemized Penalty records.
 */
export function scheduleCost(combos: readonly Combo[], ctx: ScoreCtx, out?: Penalty[]): number {
  const w = ctx.w;
  let total = 0;
  const push = (kind: Penalty["kind"], amount: number, message: string, sectionId?: string) => {
    amount = round2(amount);
    if (amount <= 0) return;
    total += amount;
    if (out) out.push(sectionId ? { kind, sectionId, amount, message } : { kind, amount, message });
  };

  // final exams
  for (let i = 0; i < combos.length; i++) {
    const a = combos[i].final;
    if (!a) continue;
    for (let j = i + 1; j < combos.length; j++) {
      const b = combos[j].final;
      if (b && a.date === b.date && a.s < b.e && b.s < a.e) {
        push(
          "finalConflict",
          w.finalConflict,
          out ? `Final exams for ${combos[i].courseCode} and ${combos[j].courseCode} overlap on ${a.date}` : "",
          out ? combos[j].sections.find((s) => s.final)?.id : undefined,
        );
      }
    }
  }

  // collect meetings per day
  let mask = 0;
  for (const d of dayBuf) d.length = 0;
  for (const c of combos) {
    mask |= c.dayMask;
    for (const sl of c.slots) dayBuf[sl.day].push(sl);
  }
  let activeDays = 0;
  let activeWeekdays = 0;
  for (let d = 0; d < 7; d++) {
    if (mask & (1 << d)) {
      activeDays++;
      if (d < 5) activeWeekdays++;
    }
  }

  if (ctx.daySpread === "compact" && activeDays > 2) {
    push("preference", (activeDays - 2) * w.compactPerExtraDay, out ? `Classes on ${activeDays} days (you prefer fewer days)` : "");
  } else if (ctx.daySpread === "spread" && activeWeekdays < ctx.spreadTarget && activeDays > 0) {
    push("preference", (ctx.spreadTarget - activeWeekdays) * w.spreadPerMissingDay, out ? `Classes on only ${activeWeekdays} weekday${activeWeekdays === 1 ? "" : "s"} (you prefer them spread out)` : "");
  }

  // preferred days off
  const offHit = mask & ctx.preferredOffMask;
  if (offHit) {
    const hit: number[] = [];
    for (let d = 0; d < 7; d++) if (offHit & (1 << d)) hit.push(d);
    push("preference", hit.length * w.preferredDayOff, out ? `Class on your preferred day${hit.length > 1 ? "s" : ""} off (${fmtDays(hit)})` : "");
  }

  // gaps and comfort times
  let gapMinutes = 0;
  let backToBack = 0;
  let overMax = 0;
  let overMaxMinutes = 0;
  let earlyMinutes = 0;
  let lateMinutes = 0;
  let earliest = Infinity;
  let latest = -Infinity;
  for (let d = 0; d < 7; d++) {
    const list = dayBuf[d];
    if (!list.length) continue;
    list.sort((a, b) => a.s - b.s || a.e - b.e);
    let end = list[0].e;
    for (let k = 0; k < list.length; k++) {
      const sl = list[k];
      if (ctx.comfortStart >= 0 && sl.s < ctx.comfortStart) {
        earlyMinutes += ctx.comfortStart - sl.s;
        if (sl.s < earliest) earliest = sl.s;
      }
      if (ctx.comfortEnd >= 0 && sl.e > ctx.comfortEnd) {
        lateMinutes += sl.e - ctx.comfortEnd;
        if (sl.e > latest) latest = sl.e;
      }
      if (k === 0) continue;
      const gap = sl.s - end;
      if (gap <= w.passingMinutes) {
        if (gap >= 0) backToBack++;
      } else {
        gapMinutes += gap;
        if (ctx.maxGap !== null && gap > ctx.maxGap) {
          overMax++;
          overMaxMinutes += gap - ctx.maxGap;
        }
      }
      if (sl.e > end) end = sl.e;
    }
  }
  if (ctx.breaks === "avoid" && gapMinutes > 0) {
    push("preference", (gapMinutes / 60) * w.gapPerHour, out ? `${fmtHours(gapMinutes)} of gaps between classes each week` : "");
  } else if (ctx.breaks === "prefer" && backToBack > 0) {
    push("preference", backToBack * w.backToBack, out ? `${backToBack} back-to-back class${backToBack === 1 ? "" : "es"} (you prefer breaks)` : "");
  }
  if (overMax > 0) {
    push(
      "preference",
      overMax * w.overMaxGap + (overMaxMinutes / 60) * w.overMaxGapPerHour,
      out ? `${overMax} gap${overMax === 1 ? "" : "s"} longer than ${ctx.maxGap} minutes` : "",
    );
  }
  if (earlyMinutes > 0) {
    push("preference", (earlyMinutes / 60) * w.comfortPerHour, out ? `Classes start as early as ${fmtClock(earliest)} (you prefer ${fmtClock(ctx.comfortStart)} or later)` : "");
  }
  if (lateMinutes > 0) {
    push("preference", (lateMinutes / 60) * w.comfortPerHour, out ? `Classes end as late as ${fmtClock(latest)} (you prefer ${fmtClock(ctx.comfortEnd)} or earlier)` : "");
  }
  return total;
}

function fmtHours(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

export function dayName(i: number): Day {
  return DAYS[i];
}

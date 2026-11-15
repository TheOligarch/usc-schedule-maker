/**
 * Stand-in for the real schedule engine (usm-engine, `engine/src/index.ts`).
 * It implements the same contract (`generateSchedules`) well enough to demo the UI:
 * linkage rule, hard constraints, penalties, ranking and blockers. The real engine
 * replaces it through src/lib/engine.ts; nothing else in the app imports this file.
 */
import type {
  Blocker,
  Day,
  GenerateOptions,
  GenerateResult,
  Penalty,
  RankedSchedule,
  ScheduleRequest,
  Section,
  TermData,
} from "../lib/contract-types";
import { isLectureType, sectionRmp } from "../lib/schedule";
import { DAY_LONG, fmtTime, insideBlocks, toMin } from "../lib/time";

interface Slot {
  day: Day;
  s: number;
  e: number;
}

interface Bundle {
  courseCode: string;
  sections: Section[];
  slots: Slot[];
  lecture: Section | null;
  guessedLink: boolean;
  units: number;
}

const MAX_BUNDLES_PER_COURSE = 600;
const MAX_VALID = 60000;
const MAX_NODES = 1_500_000;

function overlaps(a: Slot[], b: Slot[]): boolean {
  for (const x of a) for (const y of b) if (x.day === y.day && x.s < y.e && y.s < x.e) return true;
  return false;
}

function cartesian<T>(pools: T[][], cap: number): T[][] {
  let out: T[][] = [[]];
  for (const pool of pools) {
    const next: T[][] = [];
    for (const partial of out) {
      for (const item of pool) {
        next.push([...partial, item]);
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }
    out = next;
  }
  return out;
}

/** Every section combination of one course allowed by the linkage rule (contract section 4). */
export function buildBundles(data: TermData, courseCode: string): Bundle[] {
  const course = data.courses[courseCode];
  if (!course) return [];
  const secs = course.sectionIds.map((id) => data.sections[id]).filter((x): x is Section => Boolean(x));
  if (secs.length === 0) return [];

  let groups: Section[][];
  let guessed = false;
  if (course.linkage === "ambiguous") {
    // Order-based guess: each lecture pairs with the non-lecture sections that follow it.
    groups = [];
    const orphans: Section[] = [];
    let current: Section[] | null = null;
    for (const sec of secs) {
      if (isLectureType(sec.type)) {
        current = [sec];
        groups.push(current);
      } else if (current) current.push(sec);
      else orphans.push(sec);
    }
    if (groups.length === 0) groups = [orphans];
    else for (const g of groups) g.push(...orphans);
    guessed = true;
  } else {
    const letters = [...new Set(secs.map((x) => x.linkCode).filter((x): x is string => x !== null))];
    const free = secs.filter((x) => x.linkCode === null);
    if (letters.length === 0) groups = [free];
    else
      groups = letters.map((letter) => {
        const own = secs.filter((x) => x.linkCode === letter);
        const ownTypes = new Set(own.map((x) => x.type));
        return [...own, ...free.filter((x) => !ownTypes.has(x.type))];
      });
  }

  const bundles: Bundle[] = [];
  for (const group of groups) {
    const byType = new Map<string, Section[]>();
    for (const sec of group) byType.set(sec.type, [...(byType.get(sec.type) ?? []), sec]);
    for (const combo of cartesian([...byType.values()], MAX_BUNDLES_PER_COURSE)) {
      const slots: Slot[] = [];
      let selfClash = false;
      for (const sec of combo) {
        const own: Slot[] = [];
        for (const m of sec.meetings) for (const day of m.days) own.push({ day, s: toMin(m.start), e: toMin(m.end) });
        if (overlaps(slots, own)) selfClash = true;
        slots.push(...own);
      }
      if (selfClash) continue;
      bundles.push({
        courseCode,
        sections: combo,
        slots,
        lecture: combo.find((x) => isLectureType(x.type)) ?? null,
        guessedLink: guessed && combo.length > 1,
        units: course.units.min,
      });
      if (bundles.length >= MAX_BUNDLES_PER_COURSE) return bundles;
    }
  }
  return bundles;
}

function weight(importance: number): number {
  return Math.max(1, Math.min(10, importance)) / 5;
}

function scoreSchedule(data: TermData, req: ScheduleRequest, bundles: Bundle[]): RankedSchedule {
  const penalties: Penalty[] = [];
  const warnings: string[] = [];
  const w = {
    rmp: weight(req.importance.rmp),
    daySpread: weight(req.importance.daySpread),
    breaks: weight(req.importance.breaks),
    seatRisk: weight(req.importance.seatRisk),
    finals: weight(req.importance.finals),
  };
  const add = (kind: Penalty["kind"], amount: number, message: string, sectionId?: string) => {
    if (amount >= 0.25) penalties.push({ kind, amount: Math.round(amount * 10) / 10, message, sectionId });
  };

  const allSections: { sec: Section; code: string }[] = [];
  for (const b of bundles) {
    const course = data.courses[b.courseCode];
    for (const sec of b.sections) {
      allSections.push({ sec, code: b.courseCode });
      const tag = `${b.courseCode} ${sec.type} ${sec.id}`;
      if (sec.seats.registered > sec.seats.total) add("waitlist", 14 * w.seatRisk, `${tag} is over capacity (waitlist likely)`, sec.id);
      else if (sec.isFull) add("full", 14 * w.seatRisk, `${tag} is full`, sec.id);
      if (sec.online || sec.meetings.length === 0)
        add("onlineOrTba", 12, `${tag} is ${sec.online ? "online" : "TBA"} (no set meeting time)`, sec.id);
    }
    const dc = b.sections.find((x) => x.dClearance);
    if (dc) add("dClearance", 10 * w.seatRisk, `${b.courseCode} requires D-clearance`, dc.id);
    if (b.guessedLink) {
      add("ambiguousLink", 8, `${b.courseCode}: lecture/discussion pairing is a best guess`, b.lecture?.id);
      warnings.push(`${b.courseCode}: USC does not publish which sections go together; confirm the pairing in WebReg.`);
    }
    if (b.lecture) {
      const rmp = sectionRmp(data, b.lecture);
      if (!rmp) add("noRmp", 2.5 * w.rmp, `${b.courseCode} lecture instructor has no RateMyProfessors rating`, b.lecture.id);
      else if (rmp.match === "exact")
        add("preference", (5 - rmp.teacher.avg) * 1.6 * w.rmp, `${b.courseCode} lecture instructor is rated ${rmp.teacher.avg.toFixed(1)}/5`, b.lecture.id);
    }
    if (course?.prereqText) warnings.push(`${b.courseCode}: ${course.prereqText}`);
    if (course && course.units.min !== course.units.max)
      warnings.push(`${b.courseCode} is variable-unit (${course.units.min}-${course.units.max}); counted as ${course.units.min} toward your cap.`);
  }

  // Final exam conflicts
  const withFinals = allSections.filter((x) => x.sec.final);
  for (let i = 0; i < withFinals.length; i++) {
    for (let j = i + 1; j < withFinals.length; j++) {
      const a = withFinals[i].sec.final!;
      const b = withFinals[j].sec.final!;
      if (a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end))
        add("finalConflict", 18 * w.finals, `${withFinals[i].code} and ${withFinals[j].code} finals overlap on ${a.date}`, withFinals[i].sec.id);
    }
  }

  // Soft preferences
  const byDay = new Map<Day, Slot[]>();
  for (const b of bundles) for (const sl of b.slots) byDay.set(sl.day, [...(byDay.get(sl.day) ?? []), sl]);
  const dayCount = byDay.size;
  const prefs = req.preferences;
  if (prefs.daySpread === "compact" && dayCount > 2) add("preference", (dayCount - 2) * 3 * w.daySpread, `Classes on ${dayCount} days (you prefer fewer)`);
  if (prefs.daySpread === "spread" && dayCount < 5) add("preference", (5 - dayCount) * 3 * w.daySpread, `Classes packed into ${dayCount} days (you prefer them spread out)`);
  for (const day of prefs.preferredDaysOff) if (byDay.has(day)) add("preference", 4 * w.daySpread, `Has class on ${DAY_LONG[day]} (you would like it off)`);

  let totalGap = 0;
  let maxGap = 0;
  let backToBack = 0;
  let early = 0;
  let late = 0;
  for (const slots of byDay.values()) {
    slots.sort((a, b) => a.s - b.s);
    for (let i = 1; i < slots.length; i++) {
      const gap = Math.max(0, slots[i].s - slots[i - 1].e);
      totalGap += gap;
      maxGap = Math.max(maxGap, gap);
      if (gap < 15) backToBack++;
    }
    if (prefs.comfortStart && slots[0].s < toMin(prefs.comfortStart)) early++;
    if (prefs.comfortEnd && slots[slots.length - 1].e > toMin(prefs.comfortEnd)) late++;
  }
  if (prefs.breaks === "avoid") add("preference", (totalGap / 60) * 1.5 * w.breaks, `${Math.round((totalGap / 60) * 10) / 10} hr of gaps between classes (you prefer back-to-back)`);
  if (prefs.breaks === "prefer") add("preference", backToBack * 2 * w.breaks, `${backToBack} back-to-back class change${backToBack === 1 ? "" : "s"} (you prefer breaks)`);
  if (prefs.maxGapMinutes !== null && maxGap > prefs.maxGapMinutes)
    add("preference", ((maxGap - prefs.maxGapMinutes) / 60) * 3 * w.breaks, `Longest gap is ${Math.round(maxGap / 6) / 10} hr (over your ${Math.round(prefs.maxGapMinutes / 6) / 10} hr limit)`);
  if (early) add("preference", early * 2, `${early} day${early === 1 ? "" : "s"} start before ${fmtTime(prefs.comfortStart!)}`);
  if (late) add("preference", late * 2, `${late} day${late === 1 ? "" : "s"} end after ${fmtTime(prefs.comfortEnd!)}`);

  const total = penalties.reduce((sum, p) => sum + p.amount, 0);
  const courses = bundles.map((b) => ({ courseCode: b.courseCode, sectionIds: b.sections.map((x) => x.id) }));
  return {
    id: courses.flatMap((c) => c.sectionIds).sort().join("-"),
    units: bundles.reduce((sum, b) => sum + b.units, 0),
    score: Math.max(0, Math.round((100 - total) * 10) / 10),
    courses,
    penalties: penalties.sort((a, b) => b.amount - a.amount),
    warnings: [...new Set(warnings)],
  };
}

export function mockGenerateSchedules(data: TermData, req: ScheduleRequest, opts: GenerateOptions = {}): GenerateResult {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 10));
  const blockers = new Map<string, Blocker & { fatal: boolean }>();
  const block = (constraint: string, eliminated: number, message: string, fatal = false) => {
    const prev = blockers.get(constraint);
    if (!prev) blockers.set(constraint, { constraint, eliminated, message, fatal });
    else {
      // Keep the message of the most damaging instance; a fatal one always wins.
      if ((fatal && !prev.fatal) || (fatal === prev.fatal && eliminated > prev.eliminated)) prev.message = message;
      prev.eliminated += eliminated;
      prev.fatal = prev.fatal || fatal;
    }
  };

  /** Bundles of a course that survive the per-course hard constraints. */
  const usable = (courseCode: string, report: boolean): Bundle[] => {
    if (!data.courses[courseCode]) {
      if (report) block("noValidLinkCombo", 1, `${courseCode} is not offered this term.`, true);
      return [];
    }
    const all = buildBundles(data, courseCode);
    if (all.length === 0) {
      if (report) block("noValidLinkCombo", 1, `${courseCode} has no valid lecture/discussion/lab combination this term.`, true);
      return [];
    }
    const inTime = all.filter((b) => b.sections.every((sec) => sec.meetings.every((m) => m.days.every((d) => insideBlocks(m.start, m.end, req.allowedTimes[d] ?? [])))));
    if (report && inTime.length < all.length)
      block(
        "allowedTimes",
        all.length - inTime.length,
        inTime.length === 0
          ? `None of the ${all.length} section combinations of ${courseCode} fit inside your allowed times.`
          : `Your allowed times rule out ${all.length - inTime.length} of ${all.length} section combinations of ${courseCode}.`,
        inTime.length === 0,
      );
    return inTime;
  };

  interface Item {
    label: string;
    bundles: Bundle[];
  }
  const items: Item[] = [];
  for (const code of [...new Set(req.required)]) items.push({ label: code, bundles: usable(code, true) });
  for (const slot of req.flexSlots) {
    const options = slot.options.filter((code) => !req.required.includes(code));
    const bundles = options.flatMap((code) => usable(code, false));
    if (bundles.length === 0)
      block(
        "flexSlot",
        Math.max(1, options.length),
        options.length === 0 ? `"${slot.label}" has no course options yet.` : `None of the ${options.length} options for "${slot.label}" fit your allowed times.`,
        true,
      );
    items.push({ label: slot.label, bundles });
  }

  const minUnits = req.required.reduce((sum, code) => sum + (data.courses[code]?.units.min ?? 0), 0);
  if (req.unitCap !== null && minUnits > req.unitCap)
    block("unitCap", 1, `Your required courses add up to ${minUnits} units, over your ${req.unitCap}-unit cap.`, true);

  const valid: RankedSchedule[] = [];
  let totalValid = 0;
  let nodes = 0;
  const clashPairs = new Map<string, number>();

  if (items.length > 0 && items.every((it) => it.bundles.length > 0)) {
    const order = [...items].sort((a, b) => a.bundles.length - b.bundles.length);
    const chosen: Bundle[] = [];
    const walk = (depth: number, units: number) => {
      if (nodes > MAX_NODES || totalValid >= MAX_VALID) return;
      if (depth === order.length) {
        totalValid++;
        valid.push(scoreSchedule(data, req, chosen));
        return;
      }
      for (const b of order[depth].bundles) {
        nodes++;
        if (chosen.some((c) => c.courseCode === b.courseCode || c.sections.some((x) => b.sections.includes(x)))) continue;
        if (req.unitCap !== null && units + b.units > req.unitCap) {
          block("unitCap", 1, `Your ${req.unitCap}-unit cap is too low for this set of courses.`);
          continue;
        }
        const clash = chosen.find((c) => overlaps(c.slots, b.slots));
        if (clash) {
          const key = [clash.courseCode, b.courseCode].sort().join(" and ");
          clashPairs.set(key, (clashPairs.get(key) ?? 0) + 1);
          continue;
        }
        chosen.push(b);
        walk(depth + 1, units + b.units);
        chosen.pop();
      }
    };
    walk(0, 0);
  }

  if (clashPairs.size > 0) {
    const [worst, count] = [...clashPairs.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = [...clashPairs.values()].reduce((a, b) => a + b, 0);
    block("timeConflict", total, `${worst} overlap in ${count} of the combinations that were tried.`);
  }
  if (items.length === 0) block("noCourses", 1, "Add at least one required course or GE/elective slot.", true);

  valid.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const ranked = [...blockers.values()]
    .sort((a, b) => Number(b.fatal) - Number(a.fatal) || b.eliminated - a.eliminated)
    .map(({ constraint, eliminated, message }) => ({ constraint, eliminated, message }));
  if (totalValid === 0 && ranked.length === 0)
    ranked.push({ constraint: "timeConflict", eliminated: 0, message: "These courses cannot be combined without a time conflict." });

  return { totalValid, schedules: valid.slice(0, limit), blockers: ranked };
}

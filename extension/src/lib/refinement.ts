/**
 * Step 4 schedule feedback: free text -> structured constraints over the generated
 * schedules' meetings, courses, components, sections and instructors.
 *
 * A local parser handles the common phrasings; anything it cannot account for goes to
 * the `refine` AI function, whose answer is validated against the same shapes here.
 * Constraints compile to engine inputs: hard section exclusions, soft section costs and
 * whole-week schedule rules. Nothing is ever applied without being shown back to the
 * student as a summary, and text that is not understood is reported, never ignored.
 */
import type { Day, HHMM, RankedSchedule, ScheduleRule, Section, SectionType, TermData } from "./contract-types";
import { AiRateLimitError } from "./aiErrors";
import { courseSections } from "./sectionPins";
import { DAYS, fmtTime, toHHMM, toMin } from "./time";

export type Component = "lecture" | "lab" | "discussion" | "quiz";
export const COMPONENTS: Component[] = ["lecture", "lab", "discussion", "quiz"];

/** Which sections a rule is about; every given field must match. Empty = every section. */
export interface Target {
  /** full codes ("BISC-120") or department prefixes ("BISC") */
  courses?: string[];
  components?: Component[];
  sectionIds?: string[];
  /** instructor last names (or full names), case-insensitive */
  instructors?: string[];
}

export type Rule =
  | { kind: "avoidDays"; days: Day[] }
  | { kind: "onlyDays"; days: Day[] }
  | { kind: "notBefore"; time: HHMM; days?: Day[] }
  | { kind: "notAfter"; time: HHMM; days?: Day[] }
  | { kind: "avoidWindow"; start: HHMM; end: HHMM; days?: Day[] }
  | { kind: "avoidSections" }
  | { kind: "onlySections" }
  | { kind: "maxGap"; minutes: number; days?: Day[] }
  | { kind: "minBreak"; minutes: number; days?: Day[] }
  | { kind: "maxDays"; count: number }
  | { kind: "maxPerDay"; count: number; days?: Day[] }
  | { kind: "maxHoursPerDay"; minutes: number; days?: Day[] };

export interface Constraint {
  rule: Rule;
  target?: Target;
  /** false = a preference that re-ranks instead of excluding */
  hard: boolean;
}

export interface Refinement {
  scheduleId: string;
  text: string;
  summary: string;
  constraints: Constraint[];
  source: "parser" | "ai";
  /** words the interpretation did not use, shown to the student */
  ignored?: string;
}

export class RefinementError extends Error {}

const SCHEDULE_KINDS = new Set<Rule["kind"]>(["maxGap", "minBreak", "maxDays", "maxPerDay", "maxHoursPerDay"]);
export const SOFT_SECTION_COST = 6;

// ---------------------------------------------------------------------------
// Matching sections
// ---------------------------------------------------------------------------

const squash = (s: string) => s.toUpperCase().replace(/[\s_-]+/g, "");

function componentsOf(type: SectionType): Component[] {
  switch (type) {
    case "LEC": return ["lecture"];
    case "LEC-LAB": return ["lecture", "lab"];
    case "LEC-DIS": return ["lecture", "discussion"];
    case "LAB": return ["lab"];
    case "DIS": return ["discussion"];
    case "QZ": return ["quiz"];
    default: return [];
  }
}

function courseMatches(want: string, s: Section): boolean {
  const w = squash(want);
  return s.courseCodes.some((c) => squash(c) === w || (!/\d/.test(want) && c.split("-")[0].toUpperCase() === w));
}

function instructorMatches(want: string, s: Section): boolean {
  const w = want.toLowerCase().trim();
  return s.instructors.some((i) => i.last.toLowerCase() === w || `${i.first} ${i.last}`.toLowerCase() === w || i.last.toLowerCase() === w.split(/\s+/).at(-1));
}

export function matchesTarget(t: Target | undefined, s: Section): boolean {
  if (!t) return true;
  if (t.courses?.length && !t.courses.some((c) => courseMatches(c, s))) return false;
  if (t.components?.length && !componentsOf(s.type).some((c) => t.components!.includes(c))) return false;
  if (t.sectionIds?.length && !t.sectionIds.includes(s.id)) return false;
  if (t.instructors?.length && !t.instructors.some((i) => instructorMatches(i, s))) return false;
  return true;
}

const meetsOn = (days: Day[] | undefined, d: Day) => !days?.length || days.includes(d);

/** True when one section breaks a section-level rule (TBA meetings never do). */
function breaks(rule: Rule, s: Section): boolean {
  switch (rule.kind) {
    case "avoidDays": return s.meetings.some((m) => m.days.some((d) => rule.days.includes(d)));
    case "onlyDays": return s.meetings.some((m) => m.days.some((d) => !rule.days.includes(d)));
    case "notBefore": return s.meetings.some((m) => m.days.some((d) => meetsOn(rule.days, d)) && toMin(m.start) < toMin(rule.time));
    case "notAfter": return s.meetings.some((m) => m.days.some((d) => meetsOn(rule.days, d)) && toMin(m.end) > toMin(rule.time));
    case "avoidWindow": return s.meetings.some((m) => m.days.some((d) => meetsOn(rule.days, d)) && toMin(m.start) < toMin(rule.end) && toMin(rule.start) < toMin(m.end));
    case "avoidSections": return true;
    default: return false;
  }
}

function universe(data: TermData, codes: readonly string[]): Section[] {
  const seen = new Set<string>();
  const out: Section[] = [];
  for (const code of new Set(codes)) for (const s of courseSections(data, code)) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
  return out;
}

/** Sections a constraint rules out (hard) or marks down (soft), among `sections`. */
export function violatingSections(c: Constraint, sections: readonly Section[]): Section[] {
  if (SCHEDULE_KINDS.has(c.rule.kind)) return [];
  if (c.rule.kind === "onlySections") {
    // Keep the matching sections of each component they belong to; other sections of that
    // same course component go. Components with no match are left alone.
    const keep = sections.filter((s) => matchesTarget(c.target, s));
    const out: Section[] = [];
    for (const s of sections) {
      if (keep.includes(s)) continue;
      const comps = componentsOf(s.type);
      const scope = c.target?.courses?.length ? c.target.courses.some((code) => courseMatches(code, s)) : true;
      if (scope && keep.some((k) => k.courseCodes.some((code) => s.courseCodes.includes(code)) && componentsOf(k.type).some((x) => comps.includes(x)))) out.push(s);
    }
    return out;
  }
  return sections.filter((s) => matchesTarget(c.target, s) && breaks(c.rule, s));
}

export interface Compiled {
  excludedSectionIds: string[];
  sectionCosts: Record<string, { amount: number; message: string }>;
  scheduleRules: ScheduleRule[];
}

/** Engine inputs for every refinement, against the courses being scheduled. */
export function compileRefinements(refinements: readonly Refinement[], data: TermData | undefined, codes: readonly string[]): Compiled {
  const out: Compiled = { excludedSectionIds: [], sectionCosts: {}, scheduleRules: [] };
  const excluded = new Set<string>();
  const sections = data ? universe(data, codes) : [];
  for (const r of refinements) {
    for (const c of r.constraints ?? []) {
      const rule = toScheduleRule(c);
      if (rule) {
        out.scheduleRules.push(rule);
        continue;
      }
      for (const s of violatingSections(c, sections)) {
        if (c.hard) excluded.add(s.id);
        else {
          const prev = out.sectionCosts[s.id];
          const note = `Section ${s.id} misses your feedback "${describe(c)}"`;
          out.sectionCosts[s.id] = { amount: (prev?.amount ?? 0) + SOFT_SECTION_COST, message: prev ? `${prev.message}; ${describe(c)}` : note };
        }
      }
    }
  }
  out.excludedSectionIds = [...excluded].sort();
  return out;
}

function toScheduleRule(c: Constraint): ScheduleRule | null {
  const r = c.rule;
  const label = describe(c);
  switch (r.kind) {
    case "maxGap": return { kind: "maxGap", value: r.minutes, ...(r.days?.length ? { days: r.days } : {}), hard: c.hard, label };
    case "minBreak": return { kind: "minBreak", value: r.minutes, ...(r.days?.length ? { days: r.days } : {}), hard: c.hard, label };
    case "maxDays": return { kind: "maxDays", value: r.count, hard: c.hard, label };
    case "maxPerDay": return { kind: "maxPerDay", value: r.count, ...(r.days?.length ? { days: r.days } : {}), hard: c.hard, label };
    case "maxHoursPerDay": return { kind: "maxMinutesPerDay", value: r.minutes, ...(r.days?.length ? { days: r.days } : {}), hard: c.hard, label };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Describing constraints
// ---------------------------------------------------------------------------

const DAY_WORD: Record<Day, string> = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" };
const daysText = (days: Day[]) => DAYS.filter((d) => days.includes(d)).map((d) => DAY_WORD[d]).join("/");
const onDays = (days?: Day[]) => (days?.length ? ` on ${daysText(days)}` : "");
const hours = (min: number) => (min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);

const PLURAL: Record<Component, string> = { lecture: "lectures", lab: "labs", discussion: "discussions", quiz: "quizzes" };
function targetText(t: Target | undefined, fallback = "classes"): string {
  if (!t) return fallback;
  const parts: string[] = [];
  if (t.courses?.length) parts.push(t.courses.join("/"));
  if (t.sectionIds?.length) parts.push(`section${t.sectionIds.length > 1 ? "s" : ""} ${t.sectionIds.join(", ")}`);
  else if (t.components?.length) parts.push(t.components.map((c) => PLURAL[c]).join("/"));
  else if (t.courses?.length || t.instructors?.length) parts.push(t.courses?.length ? "sections" : "sections");
  if (t.instructors?.length) parts.push(`with ${t.instructors.map(cap).join(" or ")}`);
  return parts.join(" ") || fallback;
}
const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function describe(c: Constraint): string {
  const r = c.rule;
  const what = targetText(c.target);
  let text: string;
  switch (r.kind) {
    case "avoidDays": text = `No ${what} on ${daysText(r.days)}`; break;
    case "onlyDays": text = `${what.charAt(0).toUpperCase()}${what.slice(1)} only on ${daysText(r.days)}`; break;
    case "notBefore": text = `No ${what} before ${fmtTime(r.time)}${onDays(r.days)}`; break;
    case "notAfter": text = `No ${what} after ${fmtTime(r.time)}${onDays(r.days)}`; break;
    case "avoidWindow": text = `No ${what} between ${fmtTime(r.start)} and ${fmtTime(r.end)}${onDays(r.days)}`; break;
    case "avoidSections": text = `Avoid ${targetText(c.target, "these sections")}`; break;
    case "onlySections": text = `Keep ${targetText(c.target, "these sections")}`; break;
    case "maxGap": text = `No gaps longer than ${hours(r.minutes)}${onDays(r.days)}`; break;
    case "minBreak": text = `At least ${r.minutes} minutes between classes${onDays(r.days)}`; break;
    case "maxDays": text = `Classes on at most ${r.count} day${r.count === 1 ? "" : "s"} a week`; break;
    case "maxPerDay": text = `At most ${r.count} class meeting${r.count === 1 ? "" : "s"} a day${onDays(r.days)}`; break;
    case "maxHoursPerDay": text = `At most ${hours(r.minutes)} of class a day${onDays(r.days)}`; break;
  }
  return c.hard ? text : `Prefer: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export const summarize = (cs: readonly Constraint[]) => cs.map(describe).join("; ");

// ---------------------------------------------------------------------------
// Local parser
// ---------------------------------------------------------------------------

export interface ParseContext {
  data: TermData;
  /** course codes being scheduled (required + slot options) */
  codes: string[];
  schedule: RankedSchedule | null;
}

const DAY_TOKENS: [RegExp, Day[]][] = [
  [/\bweekdays?\b/g, ["Mon", "Tue", "Wed", "Thu", "Fri"]],
  [/\bweekends?\b/g, ["Sat", "Sun"]],
  [/\bmondays?\b|\bmon\b/g, ["Mon"]],
  [/\btuesdays?\b|\btues?\b/g, ["Tue"]],
  [/\bwednesdays?\b|\bweds?\b/g, ["Wed"]],
  [/\bthursdays?\b|\bthu(?:rs?)?\b/g, ["Thu"]],
  [/\bfridays?\b|\bfri\b/g, ["Fri"]],
  [/\bsaturdays?\b|\bsat\b/g, ["Sat"]],
  [/\bsundays?\b|\bsun\b/g, ["Sun"]],
];
const LETTER_DAYS = /\b(?:mtwthf|mtwrf|mwf|tth|tuth|tr|mw|wf|mf|tthf)\b/g;
const LETTER_MAP: Record<string, Day[]> = { mtwthf: ["Mon", "Tue", "Wed", "Thu", "Fri"], mtwrf: ["Mon", "Tue", "Wed", "Thu", "Fri"], mwf: ["Mon", "Wed", "Fri"], tth: ["Tue", "Thu"], tuth: ["Tue", "Thu"], tr: ["Tue", "Thu"], mw: ["Mon", "Wed"], wf: ["Wed", "Fri"], mf: ["Mon", "Fri"], tthf: ["Tue", "Thu", "Fri"] };

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const COMPONENT_WORDS: [RegExp, Component][] = [
  [/\blabs?\b|\blaborator(?:y|ies)\b/g, "lab"],
  [/\bdiscussions?\b|\bdis\b|\brecitations?\b/g, "discussion"],
  [/\blectures?\b|\blec\b/g, "lecture"],
  [/\bquiz(?:zes)?\b|\bqz\b/g, "quiz"],
];
const NEGATIVE = /\b(?:no|not|dont|do not|doesnt|cant|cannot|avoid|without|never|nothing|none|hate|skip|exclude|drop|remove|get rid of|rather not|free|off|ditch|lose)\b/;
const SOFT = /\b(?:prefer|preferably|ideally|if possible|id rather|would rather|rather|would like|id like|try to|try not|hopefully|nice|if you can|where possible|would be nice)\b/;
const KEEP = /\b(?:keep|only|must|need|want|require|stick with|lock|pin|have|like|with)\b/;

/** Words that carry no constraint meaning of their own. */
const FILLER = new Set(
  ("i im id me my mine we a an the any this that these those please pls also and or but to of for in on at by with from my any all every " +
    "class classes course courses section sections schedule schedules meeting meetings school campus day days week weeks time times " +
    "want wanted would like dont do not no avoid have having be being get got go going come coming take taking be is are am was it its " +
    "there their them they really just very so much more less than then too can could should will wont prefer rather ideally possible if " +
    "keep only must need require stick lock pin free off without never nothing none hate skip exclude drop remove rid lose ditch " +
    "before after until till earlier later past start starts starting begin begins end ends ending finish finished finishing done out " +
    "between from to through noon midnight morning mornings afternoon afternoons evening evenings night nights early late lunch " +
    "am pm oclock o clock hour hours hr hrs minute minutes min mins long longer longest short gap gaps break breaks back each per " +
    "most least max maximum minimum fewer number one two three four five six week weekly daily total straight row consecutive " +
    "professor prof dr instructor teacher taught teaches lab labs lecture lectures discussion discussions quiz quizzes " +
    "try hopefully nice ok okay fine thanks thank you also either same new different other another instead let lets make sure " +
    "that's whats what which who where when on-campus anything something stuff things thing able any more over under up down").split(/\s+/),
);

function parseClock(h: string, m: string | undefined, ap: string | undefined, hint?: "am" | "pm"): number | null {
  let hour = Number(h);
  const min = Number(m ?? 0);
  if (!Number.isFinite(hour) || hour < 0 || hour > 24 || min > 59) return null;
  const mer = ap?.replace(/\./g, "") ?? hint;
  if (mer === "am" || mer === "a") { if (hour === 12) hour = 0; if (hour > 12) return null; }
  else if (mer === "pm" || mer === "p") { if (hour < 12) hour += 12; if (hour > 24) return null; }
  else if (hour >= 1 && hour <= 7) hour += 12; // a bare "4" in class talk means 4 PM
  return hour * 60 + min;
}

const CLOCK = String.raw`(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?|am|pm|a|p)?\b`;
const CLOCK_RE = new RegExp(CLOCK);
function clockAt(text: string): number | null {
  if (/\bnoon\b/.test(text)) return 12 * 60;
  if (/\bmidnight\b/.test(text)) return 24 * 60;
  const m = CLOCK_RE.exec(text);
  return m ? parseClock(m[1], m[2], m[3]) : null;
}

interface Times {
  /** "start at/after X" */
  startAt?: number;
  /** "end/finish/done by X" */
  endBy?: number;
  /** bare "before X" / "after X"; direction depends on the clause's polarity */
  before?: number;
  after?: number;
  window?: { s: number; e: number };
}

function findDays(text: string, used: string[]): Day[] {
  const days = new Set<Day>();
  for (const [re, ds] of DAY_TOKENS) for (const m of text.matchAll(re)) { ds.forEach((d) => days.add(d)); used.push(m[0]); }
  for (const m of text.matchAll(LETTER_DAYS)) { LETTER_MAP[m[0]].forEach((d) => days.add(d)); used.push(m[0]); }
  return DAYS.filter((d) => days.has(d));
}

function findTimes(text: string, used: string[]): Times {
  const out: Times = {};
  const range = new RegExp(String.raw`(?:between|from)\s+${CLOCK}\s*(?:and|to|-|until|till)\s*${CLOCK}|${CLOCK}\s*(?:-|to)\s*${CLOCK}`).exec(text);
  if (range) {
    const g = range[1] ? range.slice(1, 7) : range.slice(7, 13);
    const endAp = g[5]?.replace(/\./g, "");
    const e = parseClock(g[3], g[4], endAp);
    // "10-2pm": an unmarked start takes the end's meridiem unless that would put it after the end
    const startHint = !g[2] && endAp ? (endAp.startsWith("p") && Number(g[0]) > Number(g[3]) && Number(g[0]) !== 12 ? "am" : endAp.startsWith("a") ? "am" : "pm") : undefined;
    const s = parseClock(g[0], g[1], g[2], startHint as "am" | "pm" | undefined);
    if (s !== null && e !== null && e > s) { out.window = { s, e }; used.push(range[0]); return out; }
  }
  const named: [RegExp, { s: number; e: number }][] = [
    [/\bearly mornings?\b/, { s: 0, e: 9 * 60 }],
    [/\bmornings?\b/, { s: 0, e: 12 * 60 }],
    [/\blunch(?:time)?\b/, { s: 12 * 60, e: 13 * 60 }],
    [/\bafternoons?\b/, { s: 12 * 60, e: 17 * 60 }],
    [/\bevenings?\b|\bnights?\b/, { s: 17 * 60, e: 24 * 60 }],
  ];
  for (const [re, w] of named) { const m = re.exec(text); if (m) { out.window = w; used.push(m[0]); return out; } }
  const word = (re: RegExp): number | undefined => {
    const m = re.exec(text);
    if (!m) return undefined;
    const t = clockAt(m[0].replace(/^\D+/, "")) ?? (/noon/.test(m[0]) ? 12 * 60 : /midnight/.test(m[0]) ? 24 * 60 : null);
    if (t === null) return undefined;
    used.push(m[0]);
    return t;
  };
  const at = String.raw`(?:${CLOCK}|noon|midnight)`;
  out.startAt = word(new RegExp(String.raw`\b(?:start|starts|starting|begin|begins|beginning|first class(?:es)?)\s+(?:at|after|no earlier than|by|from)?\s*${at}`));
  out.endBy = word(new RegExp(String.raw`\b(?:end|ends|ending|finish|finished|finishing|done|out|over|leave|wrap up)\s+(?:at|by|before|no later than)?\s*${at}`));
  if (out.endBy === undefined) out.before = word(new RegExp(String.raw`\b(?:before|earlier than|until|till|prior to)\s+${at}`));
  if (out.startAt === undefined) out.after = word(new RegExp(String.raw`\b(?:after|later than|past|beyond)\s+${at}`));
  if ([out.startAt, out.endBy, out.before, out.after].every((v) => v === undefined)) {
    if (/\bearly\b/.test(text)) { out.window = { s: 0, e: 10 * 60 }; used.push("early"); }
    else if (/\blate\b/.test(text)) { out.window = { s: 18 * 60, e: 24 * 60 }; used.push("late"); }
  }
  return out;
}

function numberAt(word: string | undefined): number | null {
  if (!word) return null;
  if (/^\d+$/.test(word)) return Number(word);
  return NUM[word] ?? null;
}

function durationMinutes(text: string, used: string[]): number | null {
  const m = /(\d+(?:\.\d+)?|an?|one|two|three|half an?)\s*(?:-|\s)?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/.exec(text);
  if (!m) return null;
  used.push(m[0]);
  const n = m[1].startsWith("half") ? 0.5 : (numberAt(m[1]) ?? Number(m[1]));
  return Math.round(/^h/.test(m[2]) ? n * 60 : n);
}

function scheduleLevel(text: string, days: Day[], hard: boolean, used: string[]): Constraint[] | null {
  // back-to-back
  if (/back[\s-]?to[\s-]?back|\bin a row\b|\bconsecutive\b|\bstraight\b/.test(text)) {
    used.push("back", "to", "row", "consecutive", "straight");
    const positive = !NEGATIVE.test(text) && /\b(?:want|prefer|like|keep|all)\b/.test(text);
    const many = /(?:more than|over|at most|max(?:imum)?|no more than)\s+(\d|two|three|four)\s+(?:classes\s+)?(?:back|in a row|consecutive|straight)/.exec(text);
    if (positive) return [{ rule: { kind: "maxGap", minutes: 15, ...(days.length ? { days } : {}) }, hard }];
    if (many) return null; // run-length limits need the AI
    const mins = /(\d+)\s*(?:-|\s)?(?:minutes?|mins?)/.exec(text);
    return [{ rule: { kind: "minBreak", minutes: mins ? Number(mins[1]) : 15, ...(days.length ? { days } : {}) }, hard }];
  }
  // breaks between classes
  const between = /\b(?:at least|minimum(?: of)?)\s+(.+?)\s+(?:break|gap|between)/.exec(text) ?? /(\d+)\s*(?:-|\s)?(?:minutes?|mins?)\s+(?:break|gap)s?\s+between/.exec(text);
  if (between) {
    const d = durationMinutes(text, used);
    if (d) { used.push("at", "least", "between"); return [{ rule: { kind: "minBreak", minutes: d, ...(days.length ? { days } : {}) }, hard }]; }
  }
  // gaps
  if (/\bgaps?\b|\bbreaks?\b|\bdowntime\b|\bwait(?:ing)?\b/.test(text)) {
    const d = durationMinutes(text, used);
    used.push("gap", "gaps", "break", "breaks", "downtime");
    if (d !== null) return [{ rule: { kind: "maxGap", minutes: d, ...(days.length ? { days } : {}) }, hard }];
    if (/\blong\b|\bbig\b|\bhuge\b|\blarge\b/.test(text)) return [{ rule: { kind: "maxGap", minutes: 60, ...(days.length ? { days } : {}) }, hard }];
    if (NEGATIVE.test(text)) return [{ rule: { kind: "maxGap", minutes: 15, ...(days.length ? { days } : {}) }, hard }];
    return null;
  }
  // classes per day / hours per day
  const perDay = /(?:no more than|at most|max(?:imum)?(?: of)?|only|up to|fewer than|less than)\s+(\d+|one|two|three|four|five|six)\s+(class meetings|classes|class|meetings|meeting|hours?|hrs?)\s*(?:of class(?:es)?\s*)?(?:a|per|each|in a|on any)\s+day/.exec(text);
  if (perDay) {
    used.push(perDay[0]);
    let n = numberAt(perDay[1])!;
    if (/fewer|less/.test(perDay[0])) n -= 1;
    if (/^h/.test(perDay[2])) return [{ rule: { kind: "maxHoursPerDay", minutes: n * 60, ...(days.length ? { days } : {}) }, hard }];
    return [{ rule: { kind: "maxPerDay", count: n, ...(days.length ? { days } : {}) }, hard }];
  }
  // days on campus
  const dayCount = /(?:no more than|at most|max(?:imum)?(?: of)?|only|just|up to|fewer than|less than)?\s*(\d|one|two|three|four|five)[\s-]+days?\b(?:\s+(?:a|per|of the|each)\s+week|\s+on campus|\s+of class(?:es)?|\s+week)?/.exec(text);
  if (dayCount && (/\bweek\b|on campus|of class|\bonly\b|at most|no more|max|fewer|less|just|up to/.test(dayCount[0]))) {
    used.push(dayCount[0]);
    let n = numberAt(dayCount[1])!;
    if (/fewer|less/.test(dayCount[0])) n -= 1;
    return [{ rule: { kind: "maxDays", count: n }, hard }];
  }
  const daysOff = /(?:a|one|two|\d)\s+days?\s+off\b|\bday off\b/.exec(text);
  if (daysOff && !days.length) {
    used.push(daysOff[0]);
    const n = numberAt(/^(\w+)/.exec(daysOff[0])?.[1]) ?? 1;
    return [{ rule: { kind: "maxDays", count: 5 - n }, hard }];
  }
  return null;
}

interface Refs { target: Target; used: string[]; thisRef: boolean; unknownProf: string | null }

function findRefs(text: string, ctx: ParseContext): Refs {
  const used: string[] = [];
  const target: Target = {};
  const { data } = ctx;
  const sections = universe(data, ctx.codes);
  // course codes and departments in play
  const courses = new Set<string>();
  const codes = [...new Set([...ctx.codes, ...(ctx.schedule?.courses.map((c) => c.courseCode) ?? [])])];
  for (const code of codes) {
    const [dept, num] = code.toLowerCase().split("-");
    const re = num ? new RegExp(String.raw`\b${dept}\s*-?\s*${num}\b`) : null;
    const m = re?.exec(text);
    if (m) { courses.add(code); used.push(m[0]); }
  }
  if (!courses.size) {
    const depts = new Set(codes.map((c) => c.split("-")[0].toLowerCase()));
    for (const d of depts) { const m = new RegExp(String.raw`\b${d}\b`).exec(text); if (m) { courses.add(d.toUpperCase()); used.push(m[0]); } }
  }
  if (!courses.size) {
    // distinctive title words ("biology lab", "thematic option")
    for (const code of codes) {
      const title = data.courses[code]?.title.toLowerCase() ?? "";
      const words = title.split(/[^a-z]+/).filter((w) => w.length >= 6 && !TITLE_STOP.has(w));
      const hit = words.find((w) => new RegExp(String.raw`\b${w.slice(0, -1)}\w*\b`).test(text));
      if (hit) { courses.add(code); used.push(...text.split(/\s+/).filter((t) => t.startsWith(hit.slice(0, -1)))); }
    }
  }
  if (courses.size) target.courses = [...courses];
  const comps = new Set<Component>();
  for (const [re, c] of COMPONENT_WORDS) for (const m of text.matchAll(re)) { comps.add(c); used.push(m[0]); }
  if (comps.size) target.components = [...comps];
  const ids = [...text.matchAll(/\b\d{5}\b/g)].map((m) => m[0]).filter((id) => sections.some((s) => s.id === id));
  if (ids.length) { target.sectionIds = ids; used.push(...ids, "section", "sections"); }
  const profs = new Set<string>();
  for (const s of sections) for (const i of s.instructors) {
    const last = i.last.toLowerCase();
    if (last.length >= 3 && new RegExp(String.raw`\b${last.replace(/[^a-z]/g, ".")}\b`).test(text)) { profs.add(i.last); used.push(last, i.first.toLowerCase()); }
  }
  if (profs.size) target.instructors = [...profs];
  // A course the student is not taking is an error, not a silent "any course".
  const allDepts = new Set(Object.keys(data.courses).map((c) => c.split("-")[0].toLowerCase()));
  for (const m of text.matchAll(/\b([a-z]{2,5})\s*-?\s*(\d{3}[a-z]?)\b/g)) {
    if (!/\d{5}/.test(m[0]) && !codes.some((c) => squash(c) === squash(m[1] + m[2]))) throw new RefinementError(`${m[1].toUpperCase()}-${m[2].toUpperCase()} is not one of the courses you are scheduling.`);
  }
  // Only "<dept> lab/class/..." counts: several department codes are also English words ("art", "pain", "plus").
  if (!courses.size) for (const m of text.matchAll(/\b([a-z]{2,5})\s+(?:labs?|discussions?|lectures?|quiz(?:zes)?|class(?:es)?|courses?|sections?)\b/g)) {
    const w = m[1];
    if (allDepts.has(w) && !FILLER.has(w) && !codes.some((c) => c.toLowerCase().startsWith(`${w}-`))) throw new RefinementError(`None of the courses you are scheduling is in ${w.toUpperCase()}.`);
  }
  const named = /\b(?:professor|prof|dr|instructor)\.?\s+([a-z][a-z'-]+)/.exec(text);
  const unknownProf = named && ![...profs].some((p) => p.toLowerCase() === named[1]) ? named[1] : null;
  const thisRef = /\b(?:this|that|my|current|these|those)\b/.test(text) && !courses.size && !ids.length;
  return { target, used, thisRef, unknownProf };
}
const TITLE_STOP = new Set(["introduction", "introductory", "general", "principles", "topics", "special", "advanced", "fundamentals", "foundations", "seminar", "studies", "programming", "systems", "science", "sciences", "writing"]);

/** Sections of the displayed schedule that match a component-only reference ("this lab"). */
function scheduleSections(ctx: ParseContext, t: Target): string[] {
  const ids = ctx.schedule?.courses.flatMap((c) => c.sectionIds) ?? [];
  return ids.filter((id) => ctx.data.sections[id] && matchesTarget(t, ctx.data.sections[id]));
}

function parseClause(raw: string, ctx: ParseContext): { constraints: Constraint[]; leftover: string[] } | null {
  const text = raw;
  const used: string[] = [];
  const hard = !SOFT.test(text);
  const negative = NEGATIVE.test(text);
  const days = findDays(text, used);

  const sched = scheduleLevel(text, days, hard, used);
  if (sched) return { constraints: sched, leftover: leftovers(text, used) };

  const refs = findRefs(text, ctx);
  used.push(...refs.used);
  if (refs.unknownProf) throw new RefinementError(`No instructor named "${cap(refs.unknownProf)}" teaches a section of your courses. Check the spelling, or name the course instead.`);
  let target: Target | undefined = Object.keys(refs.target).length ? refs.target : undefined;
  if (refs.thisRef && target?.components && !target.courses) {
    const courses = new Set((ctx.schedule?.courses ?? []).filter((c) => c.sectionIds.some((id) => ctx.data.sections[id] && matchesTarget(target, ctx.data.sections[id]))).map((c) => c.courseCode));
    if (courses.size) target = { ...target, courses: [...courses] };
  }
  const times = findTimes(text, used);
  const offDay = /\boff\b|\bfree\b|\bday off\b/.test(text) && days.length > 0;
  const keep = !negative && KEEP.test(text);
  const out: Constraint[] = [];
  const d = days.length ? { days } : {};
  const notBefore = (t: number) => out.push({ rule: { kind: "notBefore", time: toHHMM(t), ...d }, target, hard });
  const notAfter = (t: number) => out.push({ rule: { kind: "notAfter", time: toHHMM(t), ...d }, target, hard });
  const inside = keep && !/\bfree\b/.test(text); // "only between 10 and 4", "classes in the morning"

  if (times.window) {
    const { s, e } = times.window;
    if (inside) { if (s > 0) notBefore(s); if (e < 24 * 60) notAfter(e); }
    else if (s === 0) notBefore(e); // "no mornings" = nothing before noon
    else if (e >= 24 * 60) notAfter(s); // "no evening classes" = nothing after 5 PM
    else out.push({ rule: { kind: "avoidWindow", start: toHHMM(s), end: toHHMM(e), ...d }, target, hard });
  } else if ([times.startAt, times.endBy, times.before, times.after].some((v) => v !== undefined)) {
    if (times.startAt !== undefined) notBefore(times.startAt);
    if (times.endBy !== undefined) notAfter(times.endBy);
    // "no classes before 10" -> earliest start; "only before 3" -> latest end (and vice versa for "after")
    if (times.before !== undefined) (inside ? notAfter : notBefore)(times.before);
    if (times.after !== undefined) (inside ? notBefore : notAfter)(times.after);
  } else if (days.length) {
    if (negative || offDay) out.push({ rule: { kind: "avoidDays", days }, target, hard });
    else if (keep || /\bon\b/.test(text)) out.push({ rule: { kind: "onlyDays", days }, target, hard });
  } else if (target && (target.sectionIds || target.instructors)) {
    out.push({ rule: { kind: negative ? "avoidSections" : "onlySections" }, target, hard });
  } else if (target && refs.thisRef) {
    // "keep this lab" / "drop this discussion": the displayed schedule's matching sections
    const ids = scheduleSections(ctx, target);
    if (!ids.length) throw new RefinementError(`This schedule has no ${targetText(target)} to ${negative ? "avoid" : "keep"}.`);
    out.push({ rule: { kind: negative ? "avoidSections" : "onlySections" }, target: { courses: target.courses, sectionIds: ids }, hard });
  }
  if (!out.length) return null;
  return { constraints: out, leftover: leftovers(text, used) };
}

function leftovers(text: string, used: string[]): string[] {
  const usedWords = new Set(used.flatMap((u) => u.split(/[^a-z0-9]+/)).filter(Boolean));
  return text.split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w) && !usedWords.has(w) && !/^\d+$/.test(w) && !/^\d{1,2}(?:am|pm|a|p)$/.test(w));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[’'`]/g, "").replace(/[!?]+/g, ".").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

/** Clauses: sentences, or "and"/"," followed by a new instruction. */
function clauses(text: string): string[] {
  const verbs = String.raw`(?:no|not|avoid|keep|only|prefer|i|dont|do not|nothing|at most|at least|max|make|have|give|put|start|end|finish|id|also|please|and)\b`;
  return text.split(new RegExp(String.raw`[.;\n]+|,\s*(?:and\s+|but\s+)?(?=${verbs})|\s+(?:and|but)\s+(?=${verbs})|\s+(?:and also|plus)\s+`)).map((c) => c.trim()).filter(Boolean);
}

export interface ParseOutcome {
  constraints: Constraint[];
  /** clauses the parser could not interpret at all */
  unparsed: string[];
  /** words it skipped inside interpreted clauses */
  ignored: string[];
}

/** Deterministic interpretation; never throws for unknown wording (see `unparsed`). */
export function parseLocally(text: string, ctx: ParseContext): ParseOutcome {
  const out: ParseOutcome = { constraints: [], unparsed: [], ignored: [] };
  for (const clause of clauses(normalizeText(text))) {
    const r = parseClause(clause, ctx);
    if (!r) out.unparsed.push(clause);
    else { out.constraints.push(...r.constraints); out.ignored.push(...r.leftover); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation (local and AI answers alike)
// ---------------------------------------------------------------------------

const HHMM_RE = /^([01]\d|2[0-4]):[0-5]\d$/;
const isDay = (d: unknown): d is Day => typeof d === "string" && (DAYS as string[]).includes(d);

/** Coerces an untrusted constraint (e.g. from the AI) into a safe one, or null. */
export function sanitizeConstraint(raw: unknown, ctx: ParseContext): Constraint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = (raw as { rule?: Record<string, unknown> }).rule;
  if (!r || typeof r.kind !== "string") return null;
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter(isDay))] : undefined;
  const dd = days?.length ? { days } : {};
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);
  const time = (v: unknown) => (typeof v === "string" && HHMM_RE.test(v) ? v : null);
  let rule: Rule | null = null;
  switch (r.kind) {
    case "avoidDays": case "onlyDays": rule = days?.length ? { kind: r.kind, days } : null; break;
    case "notBefore": case "notAfter": { const t = time(r.time); rule = t ? { kind: r.kind, time: t, ...dd } : null; break; }
    case "avoidWindow": { const s = time(r.start), e = time(r.end); rule = s && e && toMin(e) > toMin(s) ? { kind: "avoidWindow", start: s, end: e, ...dd } : null; break; }
    case "avoidSections": case "onlySections": rule = { kind: r.kind }; break;
    case "maxGap": case "minBreak": { const m = num(r.minutes, 0, 600); rule = m !== null ? { kind: r.kind, minutes: m, ...dd } : null; break; }
    case "maxHoursPerDay": { const m = num(r.minutes, 30, 24 * 60); rule = m !== null ? { kind: "maxHoursPerDay", minutes: m, ...dd } : null; break; }
    case "maxDays": { const n = num(r.count, 1, 7); rule = n !== null ? { kind: "maxDays", count: n } : null; break; }
    case "maxPerDay": { const n = num(r.count, 1, 12); rule = n !== null ? { kind: "maxPerDay", count: n, ...dd } : null; break; }
  }
  if (!rule) return null;
  const t = (raw as { target?: Record<string, unknown> }).target;
  const strings = (v: unknown, max = 10) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length < 60).slice(0, max) : []);
  const target: Target = {};
  if (t && typeof t === "object") {
    const courses = strings(t.courses);
    const comps = strings(t.components).filter((c): c is Component => (COMPONENTS as string[]).includes(c));
    const ids = strings(t.sectionIds, 50);
    const profs = strings(t.instructors);
    if (courses.length) target.courses = courses.map((c) => c.toUpperCase().replace(/\s+/g, "-"));
    if (comps.length) target.components = comps;
    if (ids.length) target.sectionIds = ids;
    if (profs.length) target.instructors = profs;
  }
  if ((rule.kind === "avoidSections" || rule.kind === "onlySections") && !target.sectionIds && !target.instructors && !target.courses) return null;
  const hard = (raw as { hard?: unknown }).hard !== false;
  const c: Constraint = { rule, hard, ...(Object.keys(target).length ? { target } : {}) };
  return checkTarget(c, ctx) ? c : null;
}

/** A targeted rule must name something in the student's courses. */
function checkTarget(c: Constraint, ctx: ParseContext): boolean {
  if (!c.target || SCHEDULE_KINDS.has(c.rule.kind)) return true;
  return universe(ctx.data, ctx.codes).some((s) => matchesTarget(c.target, s));
}

// ---------------------------------------------------------------------------
// The whole interpretation step
// ---------------------------------------------------------------------------

export type AiInterpreter = (text: string, ctx: ParseContext) => Promise<{ constraints: unknown[]; unparsed?: string | null }>;

const HELP = "Try a day, time, gap, section or instructor, e.g. “no BISC lab on Friday”, “no classes before 10am”, “Fridays off”, “no gaps over an hour” or “avoid Professor Smith”.";

/**
 * Turns free text into a refinement. Uses the local parser first; when it cannot account for
 * the whole text, asks the AI (if available). Throws RefinementError with a student-facing
 * message when the text cannot be interpreted.
 */
export async function interpretRefinement(text: string, ctx: ParseContext, ai?: AiInterpreter | null): Promise<Refinement> {
  const trimmed = text.trim();
  if (!trimmed) throw new RefinementError("Describe a change first.");
  let local: ParseOutcome;
  try {
    local = parseLocally(trimmed, ctx);
  } catch (err) {
    if (err instanceof RefinementError && !ai) throw err;
    local = { constraints: [], unparsed: [trimmed], ignored: [] };
  }
  for (const c of local.constraints) {
    if (!checkTarget(c, ctx)) throw new RefinementError(`None of your courses has ${targetText(c.target)}. ${HELP}`);
  }
  const complete = !local.unparsed.length && !local.ignored.length && local.constraints.length > 0;
  const base = { scheduleId: ctx.schedule?.id ?? "no-feasible-schedule", text: trimmed };
  if (complete) return { ...base, constraints: local.constraints, summary: summarize(local.constraints), source: "parser" };

  let aiPause: string | null = null;
  if (ai) {
    try {
      const res = await ai(trimmed, ctx);
      const constraints = (res.constraints ?? []).map((c) => sanitizeConstraint(c, ctx)).filter((c): c is Constraint => c !== null);
      if (constraints.length) {
        const unparsed = typeof res.unparsed === "string" && res.unparsed.trim() ? res.unparsed.trim() : undefined;
        return { ...base, constraints, summary: summarize(constraints), source: "ai", ...(unparsed ? { ignored: unparsed } : {}) };
      }
      if (!local.constraints.length) throw new RefinementError(`I couldn’t turn “${trimmed}” into a schedule rule${res.unparsed ? ` (${res.unparsed})` : ""}. ${HELP}`);
    } catch (err) {
      if (err instanceof RefinementError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (err instanceof AiRateLimitError) aiPause = err.message;
      // AI unreachable: fall through to whatever the parser understood
    }
  }
  if (!local.constraints.length) {
    throw new RefinementError(`I couldn’t understand “${local.unparsed.join("; ") || trimmed}”. ${aiPause ? `${aiPause} ` : ""}${HELP}`);
  }
  const ignored = [...local.unparsed, ...(local.ignored.length ? [local.ignored.join(" ")] : [])].join("; ");
  return { ...base, constraints: local.constraints, summary: summarize(local.constraints), source: "parser", ...(ignored ? { ignored } : {}) };
}

// ---------------------------------------------------------------------------
// Suggestions inferred from the displayed schedule
// ---------------------------------------------------------------------------

const LONG_DAY: Record<Day, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const COMPONENT_NOUN: Partial<Record<SectionType, string>> = { LAB: "lab", DIS: "discussion", QZ: "quiz", LEC: "lecture" };

/**
 * Up to `max` refinements phrased around the schedule on screen, most specific first.
 * These are only candidates: the refine box shows the ones a dry run keeps feasible.
 */
export function suggestRefinements(data: TermData, schedule: RankedSchedule | null, max = 3): string[] {
  if (!schedule) return [];
  const out: string[] = [];
  const meetings: { code: string; s: Section; day: Day; start: number; end: number }[] = [];
  for (const c of schedule.courses) for (const id of c.sectionIds) {
    const s = data.sections[id];
    if (!s) continue;
    for (const m of s.meetings) for (const day of m.days) meetings.push({ code: c.courseCode, s, day, start: toMin(m.start), end: toMin(m.end) });
  }
  if (!meetings.length) return [];
  // 1. a lab/discussion/quiz on the latest weekday it meets,
  //    that the course also offers on another day (so the suggestion can actually be met)
  const elsewhere = (m: (typeof meetings)[number]) => courseSections(data, m.code).some((o) => o.type === m.s.type && o.meetings.length > 0 && o.meetings.every((x) => !x.days.includes(m.day)));
  const component = meetings.filter((m) => COMPONENT_NOUN[m.s.type] && m.s.type !== "LEC" && elsewhere(m)).sort((a, b) => DAYS.indexOf(b.day) - DAYS.indexOf(a.day) || b.start - a.start)[0];
  if (component) out.push(`No ${component.code} ${COMPONENT_NOUN[component.s.type]} on ${LONG_DAY[component.day]}`);
  // 2. the earliest start, pushed to the next hour
  const earliest = Math.min(...meetings.map((m) => m.start));
  const next = Math.floor(earliest / 60) * 60 + 60;
  if (next <= 13 * 60) out.push(`No classes before ${fmtTime(next, true)}`);
  // 3. the lightest day off, or the latest end
  const byDay = new Map<Day, number>();
  for (const m of meetings) byDay.set(m.day, (byDay.get(m.day) ?? 0) + (m.end - m.start));
  const lightest = [...byDay.entries()].filter(([d]) => DAYS.indexOf(d) < 5).sort((a, b) => a[1] - b[1])[0];
  if (lightest && byDay.size > 1) out.push(`Keep ${LONG_DAY[lightest[0]]} free`);
  else {
    const latest = Math.max(...meetings.map((m) => m.end));
    const done = Math.ceil(latest / 60) * 60 - 60;
    if (done > earliest) out.push(`Nothing after ${fmtTime(done, true)}`);
  }
  // 4. an instructor on a lecture
  const prof = meetings.find((m) => m.s.type.startsWith("LEC") && m.s.instructors.length)?.s;
  if (prof) out.push(`Avoid Professor ${prof.instructors[0].last}`);
  return [...new Set(out)].slice(0, max);
}

// ---------------------------------------------------------------------------
// Saved state from earlier builds
// ---------------------------------------------------------------------------

const LEGACY_TYPE: Partial<Record<SectionType, Component>> = { LAB: "lab", "LEC-LAB": "lab", DIS: "discussion", "LEC-DIS": "discussion", LEC: "lecture", QZ: "quiz" };

/** Builds before 0.1.5 saved `{ rule: { code, types, day, before, after }, excludedSectionIds }`. */
export function migrateRefinements(raw: unknown): Refinement[] {
  if (!Array.isArray(raw)) return [];
  const out: Refinement[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.text !== "string") continue;
    if (Array.isArray(r.constraints)) { out.push(r as unknown as Refinement); continue; }
    const legacy = r.rule as { code?: string; types?: SectionType[]; day?: Day; before?: number; after?: number } | undefined;
    if (!legacy) continue;
    const comps = [...new Set((legacy.types ?? []).map((t) => LEGACY_TYPE[t]).filter((c): c is Component => !!c))];
    const target: Target = { ...(legacy.code ? { courses: [legacy.code] } : {}), ...(comps.length ? { components: comps.includes("lecture") ? ["lecture"] : comps } : {}) };
    const rule: Rule | null = legacy.day ? { kind: "avoidDays", days: [legacy.day] } : typeof legacy.before === "number" ? { kind: "notBefore", time: toHHMM(legacy.before) } : typeof legacy.after === "number" ? { kind: "notAfter", time: toHHMM(legacy.after) } : null;
    if (!rule) continue;
    const c: Constraint = { rule, hard: true, ...(Object.keys(target).length ? { target } : {}) };
    out.push({ scheduleId: String(r.scheduleId ?? ""), text: r.text, summary: describe(c), constraints: [c], source: "parser" });
  }
  return out;
}

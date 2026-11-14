// Final exam schedule from https://arr.usc.edu/final-exam-schedule/.
//
// USC publishes finals as a *pattern* table per term (class start time + MWF/TTh pattern -> exam
// slot) plus a "common final" table for specific courses. The page is plain HTML (TablePress),
// one <h2>Season Year</h2> chapter per term. We parse it into rules and apply them to lecture
// sections. If the chapter for a term is missing or its tables don't look like what we expect,
// parseFinalsPage returns rules = null plus a warning; the caller then leaves every final null.

import type { Day, FinalExam, HHMM, Meeting, Section } from "./types.ts";
import { LECTURE_TYPES } from "./types.ts";

export const FINALS_URL = "https://arr.usc.edu/final-exam-schedule/";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEK: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY_TO_DAY: Day[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One alternative inside a row like "9:00 or 9:30 or 10:00 – 10:50 AM TTh". Minutes since midnight. */
interface StartAlt {
  start: number;
  end: number | null; // set when the row names a full range ("10:00 – 10:50"), which must match exactly
}

export interface PatternRule {
  family: "MWF" | "TTh";
  starts: StartAlt[];
  exam: FinalExam;
}

/** "Exam is in the first scheduled class period between from..to" rows. */
export interface FirstPeriodRule {
  minStart: number; // inclusive
  maxStart: number; // exclusive
  onceWeeklyOnly: boolean;
  from: string; // ISO date
  to: string; // ISO date
  start: HHMM;
  end: HHMM;
}

export interface FinalsRules {
  patterns: PatternRule[];
  firstPeriod: FirstPeriodRule[];
  saturday: { morning: FinalExam | null; afternoon: FinalExam | null };
  /** Common finals keyed by course code ("CSCI-201"). */
  common: Map<string, FinalExam>;
}

export interface FinalsParse {
  rules: FinalsRules | null;
  /** Start date of standard session 001 ("Standard session 001 dates: January 11, 2027 – ..."), ISO. */
  sessionStart: string | null;
  warnings: string[];
}

// ---------- small text helpers ----------

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#?apos;/g, "'");
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  for (const tr of tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1] ?? ""));
    rows.push(cells);
  }
  return rows;
}

const DASH = /\s*[–—-]\s*/;

function toMinutes(h: number, m: number, ampm: "AM" | "PM"): number {
  let hh = h % 12;
  if (ampm === "PM") hh += 12;
  return hh * 60 + m;
}

export function minutesOf(hhmm: HHMM): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function hhmm(minutes: number): HHMM {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function parseClock(s: string): { h: number; m: number; ampm: "AM" | "PM" | null } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|a\.m\.|p\.m\.)?$/i.exec(s.trim());
  if (!m) return null;
  const suffix = m[3]?.toUpperCase().replace(/\./g, "");
  return { h: Number(m[1]), m: Number(m[2] ?? 0), ampm: suffix === "AM" || suffix === "PM" ? suffix : null };
}

/** "11:00 AM – 1:00 PM", "8:00 – 10:00 AM" -> HHMM pair. A start without AM/PM inherits the end's, unless that would put it after the end. */
export function parseRange(s: string): { start: HHMM; end: HHMM } | null {
  const parts = s.split(DASH);
  if (parts.length !== 2) return null;
  const a = parseClock(parts[0] ?? "");
  const b = parseClock(parts[1] ?? "");
  if (!a || !b || !b.ampm) return null;
  const end = toMinutes(b.h, b.m, b.ampm);
  let start = toMinutes(a.h, a.m, a.ampm ?? b.ampm);
  if (!a.ampm && start > end) start = toMinutes(a.h, a.m, b.ampm === "PM" ? "AM" : "PM");
  return { start: hhmm(start), end: hhmm(end) };
}

function isoDate(year: number, monthIdx: number, day: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "Monday, May 10" / "May 10" / "January 11, 2027" -> ISO date. */
export function parseDate(s: string, defaultYear: number): string | null {
  const m = /(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf((m[1] ?? "").toLowerCase());
  if (month < 0) return null;
  return isoDate(m[3] ? Number(m[3]) : defaultYear, month, Number(m[2]));
}

// ---------- page parsing ----------

/** Slice of the page belonging to the "<h2>Spring 2027</h2>" chapter. */
function termChapter(html: string, termName: string): string | null {
  const heads = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  const idx = heads.findIndex((h) => cellText(h[1] ?? "").toLowerCase() === termName.toLowerCase());
  if (idx < 0) return null;
  const from = (heads[idx]?.index ?? 0) + (heads[idx]?.[0].length ?? 0);
  const to = heads[idx + 1]?.index ?? html.length;
  return html.slice(from, to);
}

/** Parses the start-time column of a pattern row. Returns null if the row isn't a pattern row. */
export function parsePatternCell(cell: string): { family: "MWF" | "TTh"; starts: StartAlt[] } | null {
  const m = /^(.*?)\s*(AM|PM)\s+(MWF|MW|TTh|TTH|TuTh|TR)$/i.exec(cell);
  if (!m) return null;
  const ampm = (m[2] ?? "").toUpperCase() as "AM" | "PM";
  const pat = (m[3] ?? "").toUpperCase();
  const family = pat.startsWith("M") ? "MWF" : "TTh";
  const starts: StartAlt[] = [];
  for (const alt of (m[1] ?? "").split(/\s+or\s+/i)) {
    const range = alt.split(DASH);
    const a = parseClock(range[0] ?? "");
    if (!a) return null;
    const start = toMinutes(a.h, a.m, a.ampm ?? ampm);
    let end: number | null = null;
    if (range.length === 2) {
      const b = parseClock(range[1] ?? "");
      if (!b) return null;
      end = toMinutes(b.h, b.m, b.ampm ?? ampm);
    } else if (range.length > 2) return null;
    starts.push({ start, end });
  }
  return starts.length ? { family, starts } : null;
}

// Rows we understand but that need no rule of their own (the matcher implements them directly,
// or they are advice for humans).
const KNOWN_TEXT_ROWS = [
  /^classes with first meeting on/i,
  /^courses with both lecture and lab/i,
  /^laboratory courses without/i,
  /^classes not scheduled to meet/i,
  /^students with conflicting/i,
];

export interface ProgramNames {
  /** normalized program name -> prefix, e.g. "computer science" -> "CSCI" */
  byName: Map<string, string>;
}

export function normName(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseFinalsPage(
  html: string,
  term: { name: string; year: number },
  programs: ProgramNames,
): FinalsParse {
  const warnings: string[] = [];
  const chapter = termChapter(html, term.name);
  if (!chapter) {
    return { rules: null, sessionStart: null, warnings: [`finals: no "${term.name}" chapter on ${FINALS_URL}; finals left null`] };
  }
  const chapterText = cellText(chapter);
  const ss = /Standard session 001 dates:\s*([A-Za-z]+ \d{1,2}, \d{4})/i.exec(chapterText);
  const sessionStart = ss ? parseDate(ss[1] ?? "", term.year) : null;

  const tables = chapter.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const patternTable = tables.find((t) => /class start time/i.test(cellText(t.slice(0, 2000))));
  if (!patternTable) {
    return { rules: null, sessionStart, warnings: [`finals: "${term.name}" has no "Class Start Time" table (page format changed?); finals left null`] };
  }

  const rules: FinalsRules = { patterns: [], firstPeriod: [], saturday: { morning: null, afternoon: null }, common: new Map() };
  const unrecognized: string[] = [];
  for (const row of tableRows(patternTable).slice(1)) {
    const [c1 = "", c2 = "", c3 = ""] = row;
    if (!c1) continue;
    if (KNOWN_TEXT_ROWS.some((re) => re.test(c1))) continue;

    const sat = /^saturday (morning|afternoon)s? only/i.exec(c1);
    if (sat) {
      const date = parseDate(c2, term.year);
      const range = parseRange(c3);
      if (date && range) rules.saturday[(sat[1] ?? "").toLowerCase() as "morning" | "afternoon"] = { date, ...range };
      else unrecognized.push(c1);
      continue;
    }

    if (/first scheduled class period/i.test(c2)) {
      const fp = parseFirstPeriodRow(c1, c2, term.year);
      if (fp) rules.firstPeriod.push(fp);
      else unrecognized.push(c1);
      continue;
    }

    const pat = parsePatternCell(c1);
    const date = parseDate(c2, term.year);
    const range = parseRange(c3);
    if (pat && date && range) rules.patterns.push({ ...pat, exam: { date, ...range } });
    else unrecognized.push(c1);
  }

  if (unrecognized.length) warnings.push(`finals: ${unrecognized.length} unrecognized row(s) in "${term.name}" pattern table: ${unrecognized.join(" | ")}`);
  if (rules.patterns.length < 8) {
    return {
      rules: null,
      sessionStart,
      warnings: [...warnings, `finals: only ${rules.patterns.length} pattern rows parsed for "${term.name}" (page format changed?); finals left null`],
    };
  }

  // Common finals: every other table in the chapter whose first column is "<Program name> <numbers>".
  for (const t of tables) {
    if (t === patternTable) continue;
    for (const row of tableRows(t)) {
      const [c1 = "", c2 = "", c3 = ""] = row;
      const date = parseDate(c2, term.year);
      const range = parseRange(c3);
      if (!date || !range) continue; // header rows
      // "French 120, 150, 220; Performance (Vocal Arts) 261"
      for (const part of c1.split(/\s*;\s*/)) {
        const m = /^(.*?)\s+(\d{2,3}[a-z]?(?:\s*,\s*\d{2,3}[a-z]?)*)$/i.exec(part);
        const prefix = m ? resolvePrefix(m[1] ?? "", programs) : null;
        if (!m || !prefix) {
          warnings.push(`finals: common-exam row not mapped to a course: "${part}"`);
          continue;
        }
        for (const num of (m[2] ?? "").split(/\s*,\s*/)) rules.common.set(`${prefix}-${num.toUpperCase()}`, { date, ...range });
      }
    }
  }
  return { rules, sessionStart, warnings };
}

/**
 * Program name -> prefix. Exact normalized name first; otherwise the single program whose name
 * contains all the words ("German" -> "German Studies", "Electrical Engineering" ->
 * "Electrical and Computer Engineering"). Null when missing or not unique.
 */
export function resolvePrefix(name: string, programs: ProgramNames): string | null {
  const n = normName(name);
  const exact = programs.byName.get(n);
  if (exact) return exact;
  const words = n.split(" ").filter(Boolean);
  if (!words.length) return null;
  const hits = new Set<string>();
  for (const [pn, prefix] of programs.byName) {
    const pw = new Set(pn.split(" "));
    if (words.every((w) => pw.has(w))) hits.add(prefix);
  }
  return hits.size === 1 ? ([...hits][0] ?? null) : null;
}

function parseFirstPeriodRow(c1: string, c2: string, year: number): FirstPeriodRule | null {
  // c1: "4:00 PM or starting after 4:00 PM but before 6:00 PM" | "6:00 PM or any class after 6:00 PM meeting once weekly"
  // c2: "4:30 – 6:30 PM first scheduled class period, May 5-12"
  const times = [...c1.matchAll(/(\d{1,2}(?::\d{2})?)\s*(AM|PM)/gi)].map((m) => {
    const c = parseClock(`${m[1]} ${m[2]}`);
    return c && c.ampm ? toMinutes(c.h, c.m, c.ampm) : NaN;
  });
  const minStart = times[0];
  if (minStart === undefined || Number.isNaN(minStart)) return null;
  const before = /before\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i.exec(c1);
  let maxStart = 24 * 60;
  if (before) {
    const c = parseClock(before[1] ?? "");
    if (!c || !c.ampm) return null;
    maxStart = toMinutes(c.h, c.m, c.ampm);
  }
  const m = /^(.*?)\s+first scheduled class period,?\s*([A-Za-z]+)\s+(\d{1,2})\s*[–—-]\s*(?:([A-Za-z]+)\s+)?(\d{1,2})/i.exec(c2);
  if (!m) return null;
  const range = parseRange(m[1] ?? "");
  const from = parseDate(`${m[2]} ${m[3]}`, year);
  const to = parseDate(`${m[4] ?? m[2]} ${m[5]}`, year);
  if (!range || !from || !to) return null;
  return { minStart, maxStart, onceWeeklyOnly: /once weekly/i.test(c1), from, to, ...range };
}

// ---------- applying rules ----------

function firstMeetingOfWeek(meetings: Meeting[]): Meeting | null {
  let best: { m: Meeting; key: number } | null = null;
  for (const m of meetings) {
    const firstDay = Math.min(...m.days.map((d) => WEEK.indexOf(d)));
    if (!Number.isFinite(firstDay)) continue;
    const key = firstDay * 1440 + minutesOf(m.start);
    if (!best || key < best.key) best = { m, key };
  }
  return best?.m ?? null;
}

/** First date in [from, to] (ISO, inclusive) that falls on one of `days`. */
export function firstDateOn(days: Day[], from: string, to: string): string | null {
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    if (days.includes(JS_DAY_TO_DAY[d.getUTCDay()] as Day)) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/**
 * Final exam slot for one section, or null when the rules don't say (non-lecture sections,
 * non-standard sessions, TBA, or class times outside the regular periods).
 */
export function finalFor(section: Pick<Section, "type" | "session" | "meetings" | "courseCodes">, rules: FinalsRules): FinalExam | null {
  if (!LECTURE_TYPES.has(section.type) || section.session !== "001" || section.meetings.length === 0) return null;

  for (const code of section.courseCodes) {
    const c = rules.common.get(code);
    if (c) return c;
  }

  // "Courses with both lecture and laboratory: according to the first lecture of the week".
  const m = firstMeetingOfWeek(section.meetings);
  if (!m) return null;
  const start = minutesOf(m.start);
  const end = minutesOf(m.end);
  const allDays = [...new Set(section.meetings.flatMap((x) => x.days))];

  if (allDays.length === 1 && allDays[0] === "Sat") {
    return start < 12 * 60 ? rules.saturday.morning : rules.saturday.afternoon;
  }

  const onceWeekly = m.days.length === 1 && section.meetings.length === 1;
  const patternHit = matchPattern(m, start, end, rules);
  // Once-weekly evening classes use the first-period rule; multi-day evening classes fall
  // through to the specific day-pattern rows (e.g. "6:00 PM MW").
  for (const fp of rules.firstPeriod) {
    if (start < fp.minStart || start >= fp.maxStart) continue;
    if (fp.onceWeeklyOnly && !onceWeekly) continue;
    const date = firstDateOn(allDays, fp.from, fp.to);
    return date ? { date, start: fp.start, end: fp.end } : null;
  }
  return patternHit;
}

function matchPattern(m: Meeting, start: number, end: number, rules: FinalsRules): FinalExam | null {
  const firstDay = WEEK[Math.min(...m.days.map((d) => WEEK.indexOf(d)))];
  // "Classes with first meeting on M or W or F: same as MWF" / "on T or Th: same as TTh".
  const family = firstDay === "Mon" || firstDay === "Wed" || firstDay === "Fri" ? "MWF" : firstDay === "Tue" || firstDay === "Thu" ? "TTh" : null;
  if (!family) return null;
  let loose: FinalExam | null = null;
  for (const p of rules.patterns) {
    if (p.family !== family) continue;
    for (const alt of p.starts) {
      if (alt.start !== start) continue;
      if (alt.end === null) loose ??= p.exam;
      else if (alt.end === end) return p.exam;
    }
  }
  return loose;
}

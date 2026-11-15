// Raw classes.usc.edu dump -> contract TermData (without finals/RMP, which are applied afterwards).

import type { Course, Day, Meeting, Section, SectionType, TermData } from "./types.ts";
import { LECTURE_TYPES } from "./types.ts";
import type { RawCourse, RawPrereqOption, RawSection, RawTermDump } from "./usc.ts";

const DAYS: ReadonlySet<string> = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const WEEK: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TYPE_BY_MODE_CODE: Record<string, SectionType> = {
  C: "LEC",
  D: "DIS",
  L: "LAB",
  LR: "LAB", // "Lab Required"
  Q: "QZ",
  CL: "LEC-LAB",
  CD: "LEC-DIS",
};

export function sectionType(s: Pick<RawSection, "rnrModeCode" | "rnrMode">): SectionType {
  const byCode = s.rnrModeCode ? TYPE_BY_MODE_CODE[s.rnrModeCode.toUpperCase()] : undefined;
  if (byCode) return byCode;
  const mode = (s.rnrMode ?? "").toLowerCase();
  if (mode === "lecture") return "LEC";
  if (mode === "discussion") return "DIS";
  if (mode.startsWith("lab")) return "LAB";
  if (mode === "quiz") return "QZ";
  if (mode === "lecture/lab") return "LEC-LAB";
  if (mode === "lecture/discussion") return "LEC-DIS";
  return "OTHER";
}

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return t || null;
}

function unitRange(values: (number | string | null | undefined)[]): { min: number; max: number } | null {
  const nums = values.map((v) => (typeof v === "number" ? v : parseFloat(String(v ?? "")))).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normTime(t: string | null | undefined): string | null {
  const m = HHMM_RE.exec((t ?? "").trim());
  return m ? `${(m[1] ?? "").padStart(2, "0")}:${m[2]}` : null;
}

/** Uses days[] (dayCode is ambiguous: "TH" = Tue+Thu, "H" = Thu). Drops TBA meetings. */
export function meetingsOf(s: Pick<RawSection, "schedule">): Meeting[] {
  const out: Meeting[] = [];
  for (const m of s.schedule ?? []) {
    const days = [...new Set((m.days ?? []).filter((d) => DAYS.has(d)))].sort((a, b) => WEEK.indexOf(a as Day) - WEEK.indexOf(b as Day)) as Day[];
    const start = normTime(m.startTime);
    const end = normTime(m.endTime);
    if (!days.length || !start || !end) continue;
    out.push({ days, start, end });
  }
  return out;
}

// ---------- online inference ----------
//
// The public payload has no modality or campus field (the site's bundle knows `modality` and
// `campusCode`, but neither is sent for sections), and session codes don't map to delivery mode
// (e.g. Viterbi session 048 holds sections noted "In-person attendance required"). So `online`
// comes from the section's own text (name + description + notes), sentence by sentence:
//   - sentences about a *different* section ("Section 14311 is for ... online students") are ignored;
//   - URLs are removed first ("request online here: https://...");
//   - online if a sentence says the section/course is online, names an online program or cohort
//     ("Online MBA program", "MAT online only", "EDL Online"), meets on/via Zoom, is
//     asynchronous, or is a DEN@Viterbi section;
//   - hybrid / in-person / on-campus wording anywhere in the section text overrides to false.
// TBA sections are NOT marked online; the engine penalizes empty meetings separately.

const ONLINE_PATTERNS: RegExp[] = [
  /\b(this|the) (section|course|class) (is|will be) (taught |offered |held |conducted |delivered )?(fully |entirely |completely |100% )?online\b/i,
  /\b(fully|entirely|completely|100%) online\b/i,
  /\bonline (course|section|class)\b/i,
  /\bonline\b[^.;:]{0,45}\b(only|students?|program|cohort)\b/i,
  /\b[A-Z]{2,5} Online\b/, // "EDL Online", "MPH Online Program"
  /\b(on|via|over|through) zoom\b/i,
  /\basynchronous(ly)?\b/i,
  /\bDEN@Viterbi\b/i,
];
const NOT_ONLINE: RegExp = /\bhybrid\b|\bin[- ]person\b|\bon[- ]campus\b|\bon-ground\b/i;

export function inferOnline(sectionId: string, texts: (string | null | undefined)[]): boolean {
  const text = texts
    .filter(Boolean)
    .join("\n")
    .replace(/https?:\/\/\S+|\b[\w.-]+\.(usc\.edu|com|org|ly)\/\S*/gi, " ");
  if (!text.trim()) return false;
  const sentences = text.split(/(?<=[.!?])\s+|\n|\s\|\s/);
  let online = false;
  for (const s of sentences) {
    const ids = [...s.matchAll(/\bsections?\s+(\d{5})\b/gi)].map((m) => m[1]);
    if (ids.length && !ids.includes(sectionId)) continue;
    if (NOT_ONLINE.test(s)) return false;
    if (ONLINE_PATTERNS.some((re) => re.test(s))) online = true;
  }
  return online;
}

// ---------- prereq / restriction text ----------

function optionText(o: RawPrereqOption): string {
  const head = o.courseSpace ?? o.theRest ?? "?";
  const ands = (o.ands ?? []).map((a) => a.courseSpace).filter(Boolean);
  return ands.length ? [head, ...ands].join(" and ") : head;
}

function requirementText(groups: RawCourse["prerequisiteCourseCodes"]): string | null {
  if (!groups?.length) return null;
  const parts = groups
    .map((g) => {
      const opts = g.courseOptions.map(optionText);
      if (opts.length <= 1) return opts[0] ?? "";
      const n = g.requiredCourses || 1;
      if (n === 1) return opts.join(" or ");
      if (n >= opts.length) return opts.join(" and ");
      return `${n} from ${opts.join(", ")}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

interface RawRestriction {
  groupDescription?: string | null;
  groupCode?: string | null;
  restrictionCode?: string | null;
}

function restrictionText(label: string, raw: unknown): string | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const rs = raw as RawRestriction[];
  const names = (code: string) =>
    rs
      .filter((r) => (r.restrictionCode ?? "").toUpperCase() === code)
      .map((r) => r.groupDescription || r.groupCode)
      .filter(Boolean)
      .join(", ");
  const inc = names("I");
  const exc = names("E");
  const parts = [inc && `open only to ${inc}`, exc && `not open to ${exc}`].filter(Boolean);
  return parts.length ? `${label}: ${parts.join("; ")}` : null;
}

export function prereqTextOf(c: RawCourse): string | null {
  const concurrent = Array.isArray(c.concurrentCourses)
    ? (c.concurrentCourses as { courseId?: string }[]).map((x) => (x.courseId ?? "").replace("-", " ")).filter(Boolean).join(", ")
    : "";
  const pre = requirementText(c.prerequisiteCourseCodes);
  const co = requirementText(c.corequisiteCourseCodes);
  const lines = [
    pre && `Prerequisite: ${pre}`,
    co && `Corequisite: ${co}`,
    concurrent && `Concurrent enrollment: ${concurrent}`,
    c.recommendedPrep && `Recommended preparation: ${c.recommendedPrep}`,
    restrictionText("Class standing", c.courseRestrictions),
    restrictionText("Major", c.majorRestrictions),
    restrictionText("School", c.schoolRestrictions),
    typeof c.duplicateCredit === "string" && c.duplicateCredit && `Duplicates credit: ${c.duplicateCredit}`,
  ].filter((x): x is string => !!x);
  return lines.length ? lines.join("\n") : null;
}

// ---------- linkage (contract section 4) ----------

/**
 * coded     = at least one section has a linkCode (same letter = taken together, null = any one of that type)
 * single    = all codes null and at most one lecture, or only one component type (nothing to pair)
 * ambiguous = all codes null, several lectures, and other component types to pair them with;
 *             the engine blocks unverifiable associations rather than guessing.
 */
export function classifyLinkage(sections: Pick<Section, "type" | "linkCode">[]): Course["linkage"] {
  if (sections.some((s) => s.linkCode !== null)) return "coded";
  const types = new Set(sections.map((s) => s.type));
  const lectures = sections.filter((s) => LECTURE_TYPES.has(s.type)).length;
  if (lectures <= 1 || types.size <= 1) return "single";
  return "ambiguous";
}

// ---------- main ----------

/**
 * The code a listing is shown under. A cross-listed course comes back once per program with the
 * same scheduledCourseCode (its home code, e.g. AMST-250) but a program-specific
 * matchedCourseCode (ENGL-250 in the ENGL program), and the same sisSectionIds. We key courses by
 * the matched code so each listing is its own Course sharing the same Section objects.
 */
export function courseCodeOf(c: RawCourse): string {
  return (c.matchedCourseCode?.courseHyphen || c.scheduledCourseCode.courseHyphen).toUpperCase();
}

export function webregUrlFor(termCode: string, courseCode: string): string {
  return `https://classes.usc.edu/term/${termCode}/course/${encodeURIComponent(courseCode)}`;
}

export interface NormalizeStats {
  rawCourses: number;
  courses: number;
  sections: number;
  cancelled: number;
  tba: number;
  online: number;
  linkage: Record<Course["linkage"], number>;
}

export function normalize(dump: RawTermDump, term: { code: string; name: string }, scrapedAt: string): { data: TermData; stats: NormalizeStats } {
  const rawByCode = new Map<string, RawCourse>();
  const rawSections = new Map<string, { raw: RawSection; courses: string[] }>();
  const ge = new Map<string, Set<string>>();
  let rawCourses = 0;
  let cancelled = 0;
  const seenCancelled = new Set<string>();

  const ingest = (c: RawCourse) => {
    rawCourses++;
    const code = courseCodeOf(c);
    if (!rawByCode.has(code)) rawByCode.set(code, c);
    for (const s of c.sections ?? []) {
      if (s.isCancelled) {
        if (!seenCancelled.has(s.sisSectionId)) cancelled++;
        seenCancelled.add(s.sisSectionId);
        continue;
      }
      const entry = rawSections.get(s.sisSectionId);
      if (entry) {
        if (!entry.courses.includes(code)) entry.courses.push(code);
      } else rawSections.set(s.sisSectionId, { raw: s, courses: [code] });
    }
  };
  for (const p of dump.programs) for (const c of p.courses) ingest(c);
  for (const g of dump.ge) {
    for (const c of g.courses) {
      ingest(c);
      const code = courseCodeOf(c);
      if (!ge.has(code)) ge.set(code, new Set());
      ge.get(code)?.add(g.category);
    }
  }

  // Preserve API order for display; the engine never infers associations from this order.
  const sections: Record<string, Section> = {};
  const sectionOrder = new Map<string, string[]>(); // course code -> section ids in source order
  let tba = 0;
  let online = 0;
  for (const [id, { raw, courses }] of rawSections) {
    const owner = rawByCode.get(courses[0] ?? "");
    const type = sectionType(raw);
    const meetings = meetingsOf(raw);
    if (!meetings.length) tba++;
    const isOnline = inferOnline(id, [raw.name, raw.description, raw.notes]);
    if (isOnline) online++;
    const units = unitRange(raw.units ?? []) ?? unitRange(owner?.courseUnits ?? []) ?? { min: 0, max: 0 };
    const sortedCodes = [...courses].sort();
    sections[id] = {
      id,
      courseCodes: sortedCodes,
      type,
      linkCode: raw.linkCode?.trim() || null,
      session: raw.session?.rnrSessionCode ?? "001",
      units,
      dClearance: !!raw.hasDClearance,
      seats: { registered: raw.registeredSeats ?? 0, total: raw.totalSeats ?? 0 },
      isFull: !!raw.isFull,
      online: isOnline,
      // classes.usc.edu sends no campus field for sections (checked 2026-11-14 over all 9.2k
      // Spring 2027 sections). Fill it here if `campusCode` ever starts arriving.
      campus: typeof raw.campusCode === "string" && raw.campusCode.trim() ? raw.campusCode.trim() : null,
      instructors: (raw.instructors ?? [])
        .filter((i) => (i.firstName ?? "").trim() || (i.lastName ?? "").trim())
        .map((i) => ({ first: (i.firstName ?? "").trim(), last: (i.lastName ?? "").trim(), rmpId: null, rmpMatch: null })),
      meetings,
      final: null,
      notes: [raw.name, raw.description, raw.notes].map(stripHtml).filter(Boolean).join("\n") || null,
      webregUrl: webregUrlFor(term.code, courses[0] ?? ""),
    };
    for (const code of courses) {
      if (!sectionOrder.has(code)) sectionOrder.set(code, []);
      sectionOrder.get(code)?.push(id);
    }
  }

  const courses: Record<string, Course> = {};
  const linkage = { coded: 0, single: 0, ambiguous: 0 };
  for (const [code, raw] of [...rawByCode].sort(([a], [b]) => a.localeCompare(b))) {
    const ids = sectionOrder.get(code) ?? [];
    if (!ids.length) continue; // course with only cancelled sections
    const secs = ids.map((id) => sections[id] as Section);
    const cross = new Set<string>();
    for (const s of secs) for (const c of s.courseCodes) if (c !== code) cross.add(c);
    for (const alt of [raw.scheduledCourseCode?.courseHyphen, raw.publishedCourseCode?.courseHyphen]) {
      const a = alt?.toUpperCase();
      if (a && a !== code && rawByCode.has(a)) cross.add(a);
    }
    const maxUnits = parseFloat(String(raw.maxUnits ?? ""));
    const units = unitRange([...(raw.courseUnits ?? []), ...(Number.isFinite(maxUnits) ? [maxUnits] : [])]) ??
      unitRange(secs.flatMap((s) => [s.units.min, s.units.max])) ?? { min: 0, max: 0 };
    const kind = classifyLinkage(secs);
    linkage[kind]++;
    courses[code] = {
      code,
      title: (raw.name ?? "").trim() || code,
      description: stripHtml(raw.description),
      units,
      ge: [...(ge.get(code) ?? [])].sort(),
      crossListedWith: [...cross].sort(),
      prereqText: prereqTextOf(raw),
      linkage: kind,
      sectionIds: ids,
    };
  }

  // Drop sections whose every course was dropped (cannot happen today; keeps the file consistent).
  for (const [id, s] of Object.entries(sections)) {
    s.courseCodes = s.courseCodes.filter((c) => courses[c]);
    if (!s.courseCodes.length) delete sections[id];
  }

  return {
    data: { term: { code: term.code, name: term.name, scrapedAt }, courses, sections, rmp: {} },
    stats: { rawCourses, courses: Object.keys(courses).length, sections: Object.keys(sections).length, cancelled, tba, online, linkage },
  };
}

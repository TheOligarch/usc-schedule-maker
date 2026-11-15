/**
 * Shared types for the USC Schedule Maker engine.
 *
 * Sections 1 and 3 of the shared build contract define these shapes; other
 * packages (scraper, extension) build against them, so keep them in sync with
 * the contract. Engine-only additions are marked "engine extension".
 */

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
/** 24h clock time, "HH:MM". */
export type HHMM = string;

// ---------------------------------------------------------------------------
// Contract section 1: term data file
// ---------------------------------------------------------------------------

export interface TermData {
  term: { code: string; name: string; scrapedAt: string };
  /** key = course code, e.g. "CSCI-201" */
  courses: Record<string, Course>;
  /** key = sisSectionId, e.g. "30381"; cancelled sections are omitted */
  sections: Record<string, Section>;
  /** key = RMP legacyId as string */
  rmp: Record<string, RmpTeacher>;
}

export interface Course {
  code: string;
  title: string;
  description: string | null;
  units: { min: number; max: number };
  /** current GE category codes only, e.g. ["QREA"], ["GPH"] */
  ge: string[];
  /** other course codes sharing sections */
  crossListedWith: string[];
  /** human-readable prereqs/coreqs/restrictions, warning only */
  prereqText: string | null;
  /** see contract section 4 */
  linkage: "coded" | "single" | "ambiguous";
  sectionIds: string[];
}

export type SectionType = "LEC" | "DIS" | "LAB" | "QZ" | "LEC-LAB" | "LEC-DIS" | "OTHER";

export interface Instructor {
  first: string;
  last: string;
  rmpId: string | null;
  rmpMatch: "exact" | "initial" | null;
}

export interface Meeting {
  days: Day[];
  start: HHMM;
  end: HHMM;
}

export interface Section {
  id: string;
  /** all codes this section is listed under (cross-listing) */
  courseCodes: string[];
  type: SectionType;
  /** same letter = goes together; null = any one of that type */
  linkCode: string | null;
  /** "001" = regular */
  session: string;
  units: { min: number; max: number };
  dClearance: boolean;
  seats: { registered: number; total: number };
  isFull: boolean;
  online: boolean;
  /** null when the source has no campus info */
  campus: string | null;
  instructors: Instructor[];
  /** empty = TBA */
  meetings: Meeting[];
  final: { date: string; start: HHMM; end: HHMM } | null;
  notes: string | null;
  webregUrl: string;
}

export interface RmpTeacher {
  legacyId: string;
  first: string;
  last: string;
  department: string;
  avg: number;
  difficulty: number;
  count: number;
  wouldTakeAgain: number | null;
}

// ---------------------------------------------------------------------------
// Contract section 3: engine API
// ---------------------------------------------------------------------------

export interface Block {
  start: HHMM;
  end: HHMM;
}

export interface Importance {
  rmp: number;
  daySpread: number;
  breaks: number;
  seatRisk: number;
  finals: number;
}

export interface ScheduleRequest {
  /**
   * Optional hard section choices per required course: a lecture, a linked lab/discussion/quiz,
   * or several of them. Every pinned id must be in the chosen combination; the rest of the
   * linked components are still required. A single string is accepted for older callers.
   */
  sectionPins?: Record<string, string | string[]>;
  /** Relevance 0..1 for shortlisted electives, from selected interest categories. */
  courseInterestScores?: Record<string, number>;
  /** Hard exclusions compiled from results-page feedback. */
  excludedSectionIds?: string[];
  /** Engine extension: soft per-section costs compiled from results-page feedback. */
  sectionCosts?: Record<string, { amount: number; message: string }>;
  /** Engine extension: whole-week limits compiled from results-page feedback. */
  scheduleRules?: ScheduleRule[];
  /** course codes that must all appear */
  required: string[];
  /** each slot: exactly one of up to 5 interchangeable courses (AI shortlist) */
  flexSlots: { label: string; options: string[] }[];
  /** every meeting must sit inside a block; [] = day off */
  allowedTimes: Record<Day, Block[]>;
  /** counts each course's units.min */
  unitCap: number | null;
  /** @deprecated Ignored. Professor ratings rank schedules via importance.rmp; they never exclude one. */
  minRmp?: number | null;
  /** 1-10 each */
  importance: Importance;
  preferences: Preferences;
}

/**
 * Engine extension: a limit over the whole week. `value` is minutes for maxGap, minBreak and
 * maxMinutesPerDay, and a count for maxDays and maxPerDay (meetings per day). Hard rules
 * exclude schedules; soft ones add a "preference" penalty per violation.
 */
export interface ScheduleRule {
  kind: "maxGap" | "minBreak" | "maxDays" | "maxPerDay" | "maxMinutesPerDay";
  value: number;
  /** limit per-day rules (or the counted days, for maxDays) to these days; all days when omitted */
  days?: Day[];
  hard: boolean;
  /** student-facing description, used in penalties and blockers */
  label: string;
}

export interface Preferences {
  /** stack on few days vs spread out */
  daySpread: "compact" | "neutral" | "spread";
  /** gaps between classes in a day */
  breaks: "avoid" | "neutral" | "prefer";
  maxGapMinutes: number | null;
  /** soft (hard days off come from allowedTimes) */
  preferredDaysOff: Day[];
  /** soft, inside the hard blocks */
  comfortStart: HHMM | null;
  comfortEnd: HHMM | null;
  notes: string | null;
}

export type PenaltyKind =
  | "full"
  | "waitlist"
  | "dClearance"
  | "onlineOrTba"
  | "finalConflict"
  | "ambiguousLink"
  | "noRmp"
  | "preference";

export interface Penalty {
  kind: PenaltyKind;
  sectionId?: string;
  amount: number;
  message: string;
}

export interface RankedSchedule {
  id: string;
  units: number;
  score: number;
  courses: { courseCode: string; sectionIds: string[] }[];
  penalties: Penalty[];
  warnings: string[];
}

/**
 * constraint is one of "allowedTimes", "unitCap", "timeConflict",
 * "noValidLinkCombo", "unknownCourse", "requiredCourse", "flexSlot", "combination".
 */
export interface Blocker {
  constraint: string;
  eliminated: number;
  message: string;
}

export interface GenerateResult {
  /** Equivalent meeting days/times counted once, among enumerated leaves. */
  totalDistinct?: number;
  /** number of valid schedules found (a lower bound when `truncated`) */
  totalValid: number;
  /** sorted best-first, length <= limit */
  schedules: RankedSchedule[];
  /** ranked most-eliminating first; always filled when totalValid === 0 */
  blockers: Blocker[];
  /**
   * Engine extension: true when enumeration stopped at `maxEnumerate` valid
   * schedules. The returned schedules are the best among those enumerated.
   */
  truncated?: boolean;
}

/** Engine extension: options accepted by generateSchedules / generateSchedulesAsync. */
export interface GenerateOptions {
  /** number of schedules to return; default 10, clamped to 1..100 */
  limit?: number;
  /** stop enumerating after this many valid schedules (default 100000) */
  maxEnumerate?: number;
  /** override individual scoring weights (see weights.ts) */
  weights?: Partial<import("./weights").Weights>;
  /** compute blockers (default true) */
  diagnostics?: boolean;
}

export interface AsyncGenerateOptions extends GenerateOptions {
  /** abort the run; the promise rejects with an Error named "AbortError" */
  signal?: AbortSignal;
  /** milliseconds of work between yields to the event loop (default 12) */
  sliceMs?: number;
}

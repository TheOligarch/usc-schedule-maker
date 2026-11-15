/**
 * Shared build contract types, copied verbatim from the cross-task contract
 * (term data file, engine API, AI functions). Do not edit the shapes here without
 * changing the contract for usm-data / usm-engine / usm-ai as well.
 */

// ---- 1. Term data file -----------------------------------------------------------

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type HHMM = string; // 24h "HH:MM"

export interface TermIndex {
  terms: TermRef[];
}
export interface TermRef {
  code: string;
  name: string;
  scrapedAt: string;
}

export interface TermData {
  term: TermRef;
  courses: Record<string, Course>; // key = course code "CSCI-201"
  sections: Record<string, Section>; // key = sisSectionId "30381"; cancelled sections are omitted
  rmp: Record<string, RmpTeacher>; // key = RMP legacyId as string
}

export interface Course {
  code: string; // "CSCI-201"
  title: string;
  description: string | null;
  units: { min: number; max: number };
  ge: string[]; // current GE category codes only
  crossListedWith: string[]; // other course codes sharing sections
  prereqText: string | null; // human-readable prereqs/coreqs/restrictions, warning only
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
  courseCodes: string[]; // all codes this section is listed under (cross-listing)
  type: SectionType;
  linkCode: string | null; // same letter = goes together; null = any one of that type
  session: string; // "001" = regular
  units: { min: number; max: number };
  dClearance: boolean;
  seats: { registered: number; total: number };
  isFull: boolean;
  online: boolean;
  campus: string | null;
  instructors: Instructor[];
  meetings: Meeting[]; // empty = TBA
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

// ---- 3. Engine API ---------------------------------------------------------------

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
  required: string[]; // course codes that must all appear
  flexSlots: { label: string; options: string[] }[]; // exactly one of up to 5 interchangeable courses per slot
  allowedTimes: Record<Day, Block[]>; // every meeting must sit inside a block; [] = day off
  unitCap: number | null; // counts each course's units.min
  minRmp?: number | null; // deprecated and ignored; use importance.rmp for soft ranking
  importance: Importance; // 1-10 each
  preferences: Preferences;
}

export interface Preferences {
  daySpread: "compact" | "neutral" | "spread";
  breaks: "avoid" | "neutral" | "prefer";
  maxGapMinutes: number | null;
  preferredDaysOff: Day[]; // soft (hard days off come from allowedTimes)
  comfortStart: HHMM | null;
  comfortEnd: HHMM | null; // soft, inside the hard blocks
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

export interface Blocker {
  constraint: string; // e.g. "allowedTimes", "unitCap", "timeConflict", "noValidLinkCombo"
  eliminated: number;
  message: string;
}

export interface GenerateResult {
  totalValid: number;
  schedules: RankedSchedule[]; // sorted best-first, length <= limit
  blockers: Blocker[]; // ranked most-eliminating first (always filled when totalValid === 0)
}

export interface GenerateOptions {
  limit?: number; // default 10, max 100
}

export type GenerateSchedulesFn = (data: TermData, req: ScheduleRequest, opts?: GenerateOptions) => GenerateResult;

// ---- 5. AI functions -------------------------------------------------------------

export interface InterviewSlot {
  label: string;
  kind: "GE" | "elective";
  geCategory?: string;
}

export interface InterviewHistoryItem {
  questionId: string;
  question: string;
  answer: string;
  freeText?: string;
}

export interface InterviewRequest {
  termCode: string;
  required: string[];
  slots: InterviewSlot[];
  history: InterviewHistoryItem[];
  /** Optional (added by usm-ai): the student's hard window so time quick-replies stay inside it. */
  hardHours?: { earliestStart: HHMM; latestEnd: HHMM };
}

export interface InterviewQuestion {
  id: string;
  text: string;
  options: string[];
  allowFreeText: true;
}

export interface Shortlist {
  label: string;
  options: { courseCode: string; reason: string }[];
}

export interface InterviewDone {
  done: true;
  preferences: Preferences;
  shortlists: Shortlist[];
  summary: string[];
}

export type InterviewResponse = { done: false; question: InterviewQuestion } | InterviewDone;

export interface ExplainRequest {
  preferences: Preferences;
  schedules: (RankedSchedule & { display: string })[]; // top <= 10
}

export interface ExplainResponse {
  explanations: { id: string; text: string }[];
}

export interface AiHealth {
  keyPresent: boolean;
  model: string;
  modelOk: boolean;
}

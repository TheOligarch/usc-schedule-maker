// TermData shape from the shared build contract, section 1. Keep this file in sync with the contract:
// engine/ and extension/ consume exactly this JSON.

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type HHMM = string; // 24h "HH:MM"

export interface TermData {
  term: { code: string; name: string; scrapedAt: string };
  courses: Record<string, Course>; // key = course code "CSCI-201"
  sections: Record<string, Section>; // key = sisSectionId "30381"; cancelled sections are omitted
  rmp: Record<string, RmpTeacher>; // key = RMP legacyId as string
}

export interface Course {
  code: string;
  title: string;
  description: string | null;
  units: { min: number; max: number };
  ge: string[];
  crossListedWith: string[];
  prereqText: string | null;
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

export interface FinalExam {
  date: string; // ISO "2027-05-10"
  start: HHMM;
  end: HHMM;
}

export interface Section {
  id: string;
  courseCodes: string[];
  type: SectionType;
  linkCode: string | null;
  session: string;
  units: { min: number; max: number };
  dClearance: boolean;
  seats: { registered: number; total: number };
  isFull: boolean;
  online: boolean;
  campus: string | null;
  instructors: Instructor[];
  meetings: Meeting[];
  final: FinalExam | null;
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

export interface TermIndex {
  terms: { code: string; name: string; scrapedAt: string }[];
}

/** Credit line the UI must show wherever RMP numbers appear. */
export const RMP_CREDIT = "Ratings from RateMyProfessors.com";

export const LECTURE_TYPES: ReadonlySet<SectionType> = new Set(["LEC", "LEC-LAB", "LEC-DIS"]);

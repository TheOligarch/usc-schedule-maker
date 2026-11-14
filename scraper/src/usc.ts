// Client for the anonymous classes.usc.edu JSON API (only the public read routes).

import { MAX_CONCURRENCY, fetchJson, mapLimit } from "./http.ts";

export const USC_API = "https://classes.usc.edu/api";

// ---- raw response shapes (only the fields we read) ----

export interface RawTerm {
  termCode: number;
  season: string;
  year: number;
  status: string;
}

export interface RawProgram {
  prefix: string;
  name: string;
}

export interface RawSchool {
  prefix: string;
  name: string;
  programs: RawProgram[] | null;
}

export interface RawCourseCode {
  prefix: string;
  number: string;
  suffix: string;
  courseHyphen: string;
  courseSpace: string;
}

export interface RawMeeting {
  dayCode: string | null;
  days: string[] | null;
  startTime: string | null;
  endTime: string | null;
}

export interface RawSection {
  sisSectionId: string;
  linkCode: string | null;
  hasDClearance: boolean;
  schedule: RawMeeting[] | null;
  totalSeats: number | null;
  registeredSeats: number | null;
  rnrMode: string | null;
  rnrModeCode: string | null;
  session: { rnrSessionCode: string | null; description: string | null } | null;
  units: string[] | null;
  instructors: { firstName: string | null; lastName: string | null }[] | null;
  isCancelled: boolean;
  isFull: boolean;
  notes: string | null;
  description: string | null;
  name: string | null;
  classType: string | null;
  campusCode?: string | null;
  [key: string]: unknown;
}

export interface RawPrereqOption {
  courseSpace?: string;
  theRest?: string;
  ands?: { courseSpace?: string }[];
}

export interface RawCourse {
  scheduledCourseCode: RawCourseCode;
  publishedCourseCode: RawCourseCode | null;
  /** The code this listing is shown under (differs from scheduledCourseCode for cross-listings). */
  matchedCourseCode?: RawCourseCode | null;
  name: string;
  description: string | null;
  courseUnits: number[] | null;
  isCrossListed: boolean;
  sections: RawSection[] | null;
  prerequisiteCourseCodes: { requiredCourses: number; courseOptions: RawPrereqOption[] }[] | null;
  corequisiteCourseCodes: { requiredCourses: number; courseOptions: RawPrereqOption[] }[] | null;
  courseRestrictions: unknown;
  majorRestrictions: unknown;
  schoolRestrictions: unknown;
  concurrentCourses: unknown;
  recommendedPrep: string | null;
  courseNotes: string | null;
  [key: string]: unknown;
}

export interface RawGeTree {
  geGroups: {
    groupType: string;
    requirements: { prefix: string; name: string; categories: { prefix: string; name: string }[] }[];
  }[];
}

/** Current GE system only (contract: no pre-2015 GE). */
export const CURRENT_GE_GROUP = "Fall2015OrLater";

// ---- calls ----

export function getActiveTerms(): Promise<RawTerm[]> {
  return fetchJson<RawTerm[]>(`${USC_API}/Terms/Active`);
}

export function getSchools(termCode: string): Promise<RawSchool[]> {
  return fetchJson<RawSchool[]>(`${USC_API}/Schools/TermCode?termCode=${termCode}`);
}

export async function getProgramCourses(termCode: string, school: string, program: string): Promise<RawCourse[]> {
  const q = new URLSearchParams({ termCode, school, program });
  const res = await fetchJson<{ courses: RawCourse[] | null }>(`${USC_API}/Courses/CoursesByTermSchoolProgram?${q}`);
  return res.courses ?? [];
}

export function getGeTree(termCode: string): Promise<RawGeTree> {
  return fetchJson<RawGeTree>(`${USC_API}/Ge/TermCode?termCode=${termCode}`);
}

export async function getGeCourses(termCode: string, requirement: string, category: string): Promise<RawCourse[]> {
  const q = new URLSearchParams({ termCode, geRequirementPrefix: requirement, categoryPrefix: category });
  const res = await fetchJson<{ courses: RawCourse[] | null } | RawCourse[]>(`${USC_API}/Courses/GeCoursesByTerm?${q}`);
  return Array.isArray(res) ? res : (res.courses ?? []);
}

export interface RawTermDump {
  termCode: string;
  schools: RawSchool[];
  /** One entry per (school, program) request. */
  programs: { school: string; program: string; courses: RawCourse[] }[];
  /** One entry per current-system GE category. */
  ge: { requirement: string; category: string; courses: RawCourse[] }[];
}

/**
 * Fetch everything for one term. Any request that still fails after retries rejects the whole
 * dump, so the caller never publishes a partial term.
 */
export async function fetchTermDump(termCode: string, log: (msg: string) => void): Promise<RawTermDump> {
  const schools = await getSchools(termCode);
  const pairs = schools.flatMap((s) => (s.programs ?? []).map((p) => ({ school: s.prefix, program: p.prefix })));
  log(`term ${termCode}: ${schools.length} schools, ${pairs.length} programs`);
  let done = 0;
  const programs = await mapLimit(pairs, MAX_CONCURRENCY, async (p) => {
    const courses = await getProgramCourses(termCode, p.school, p.program);
    done++;
    if (done % 50 === 0) log(`  programs ${done}/${pairs.length}`);
    return { ...p, courses };
  });

  const tree = await getGeTree(termCode);
  const cats = tree.geGroups
    .filter((g) => g.groupType === CURRENT_GE_GROUP)
    .flatMap((g) => g.requirements.flatMap((r) => r.categories.map((c) => ({ requirement: r.prefix, category: c.prefix }))));
  if (cats.length === 0) throw new Error(`term ${termCode}: GE tree has no ${CURRENT_GE_GROUP} categories`);
  const ge = await mapLimit(cats, MAX_CONCURRENCY, async (c) => ({
    ...c,
    courses: await getGeCourses(termCode, c.requirement, c.category),
  }));
  log(`term ${termCode}: ${ge.length} GE categories`);
  return { termCode, schools, programs, ge };
}

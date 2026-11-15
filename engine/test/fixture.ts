/**
 * Hand-written term data matching contract section 1, covering:
 *  - CSCI-201  coded linkage (A/B letters plus a null-coded quiz any combo takes)
 *  - MATH-226  single linkage (one lecture, any discussion; one discussion full)
 *  - WRIT-150  coded linkage (two lectures, explicit discussion groups)
 *  - AME-101   cross-listed with ISE-101 (ISE-101 exists only on the section)
 *  - GESM-110  online with TBA meetings
 *  - PHIL-140  D-clearance
 *  - MUSC-101  waitlisted, variable units
 *  - ARLT-100  final exam that conflicts with CSCI-201
 *  - AHIS-120  low-rated lecture instructor
 *  - PHRD-101  meets at HSC
 *  - CSCI-270  always overlaps AME-101
 *  - EMPT-100  no sections left (all cancelled)
 */
import type { Course, Day, Preferences, ScheduleRequest, Section, TermData } from "../src/types";

type SectionInput = Partial<Section> & Pick<Section, "id" | "type"> & { code: string; days?: Day[]; start?: string; end?: string };

function sec(i: SectionInput): Section {
  const meetings = i.meetings ?? (i.days ? [{ days: i.days, start: i.start!, end: i.end! }] : []);
  return {
    id: i.id,
    courseCodes: i.courseCodes ?? [i.code],
    type: i.type,
    linkCode: i.linkCode ?? null,
    session: i.session ?? "001",
    units: i.units ?? { min: i.type.startsWith("LEC") ? 4 : 0, max: i.type.startsWith("LEC") ? 4 : 0 },
    dClearance: i.dClearance ?? false,
    seats: i.seats ?? { registered: 10, total: 50 },
    isFull: i.isFull ?? false,
    online: i.online ?? false,
    campus: i.campus ?? null,
    instructors: i.instructors ?? [],
    meetings,
    final: i.final ?? null,
    notes: i.notes ?? null,
    webregUrl: i.webregUrl ?? `https://classes.usc.edu/term-20271/classes/${i.code.toLowerCase()}`,
  };
}

function course(c: Partial<Course> & Pick<Course, "code" | "linkage" | "sectionIds">): Course {
  return {
    code: c.code,
    title: c.title ?? c.code,
    description: c.description ?? null,
    units: c.units ?? { min: 4, max: 4 },
    ge: c.ge ?? [],
    crossListedWith: c.crossListedWith ?? [],
    prereqText: c.prereqText ?? null,
    linkage: c.linkage,
    sectionIds: c.sectionIds,
  };
}

const ada = { first: "Ada", last: "Lovelace", rmpId: "1001", rmpMatch: "exact" as const };
const bob = { first: "Bob", last: "Low", rmpId: "1002", rmpMatch: "exact" as const };
const cy = { first: "Cy", last: "Few", rmpId: "1003", rmpMatch: "exact" as const };
const dee = { first: "D.", last: "Init", rmpId: "1004", rmpMatch: "initial" as const };
const eve = { first: "Eve", last: "Mid", rmpId: "1005", rmpMatch: "exact" as const };
const unmatched = { first: "Nora", last: "Nobody", rmpId: null, rmpMatch: null };

const FINAL_CSCI = { date: "2027-05-05", start: "08:00", end: "10:00" };

const sections: Section[] = [
  // CSCI-201 coded
  sec({ code: "CSCI-201", id: "30001", type: "LEC", linkCode: "A", days: ["Mon", "Wed"], start: "10:00", end: "11:50", instructors: [ada], final: FINAL_CSCI }),
  sec({ code: "CSCI-201", id: "30002", type: "LEC", linkCode: "B", days: ["Tue", "Thu"], start: "14:00", end: "15:50", instructors: [bob], final: FINAL_CSCI }),
  sec({ code: "CSCI-201", id: "30003", type: "DIS", linkCode: "A", days: ["Fri"], start: "10:00", end: "10:50" }),
  sec({ code: "CSCI-201", id: "30004", type: "DIS", linkCode: "A", days: ["Fri"], start: "12:00", end: "12:50" }),
  sec({ code: "CSCI-201", id: "30005", type: "DIS", linkCode: "B", days: ["Thu"], start: "16:00", end: "16:50" }),
  sec({ code: "CSCI-201", id: "30006", type: "QZ", linkCode: null, days: ["Fri"], start: "14:00", end: "14:50" }),
  // MATH-226 single
  sec({ code: "MATH-226", id: "31001", type: "LEC", days: ["Tue", "Thu"], start: "08:00", end: "09:20", instructors: [eve], final: { date: "2027-05-07", start: "11:00", end: "13:00" } }),
  sec({ code: "MATH-226", id: "31002", type: "DIS", days: ["Tue"], start: "10:00", end: "10:50" }),
  sec({ code: "MATH-226", id: "31003", type: "DIS", days: ["Wed"], start: "12:00", end: "12:50", isFull: true, seats: { registered: 30, total: 30 } }),
  // WRIT-150 synthetic coded groups, independent of section order
  sec({ code: "WRIT-150", id: "32001", linkCode: "A", type: "LEC", days: ["Mon", "Wed"], start: "12:00", end: "13:20" }),
  sec({ code: "WRIT-150", id: "32002", linkCode: "A", type: "DIS", days: ["Fri"], start: "09:00", end: "09:50" }),
  sec({ code: "WRIT-150", id: "32003", linkCode: "B", type: "LEC", days: ["Tue", "Thu"], start: "12:30", end: "13:50", instructors: [cy] }),
  sec({ code: "WRIT-150", id: "32004", linkCode: "B", type: "DIS", days: ["Fri"], start: "11:00", end: "11:50" }),
  sec({ code: "WRIT-150", id: "32005", linkCode: "B", type: "DIS", days: ["Fri"], start: "13:00", end: "13:50" }),
  // AME-101 / ISE-101 cross-listed
  sec({ code: "AME-101", id: "33001", type: "LEC", courseCodes: ["AME-101", "ISE-101"], days: ["Tue", "Thu"], start: "16:00", end: "17:20", instructors: [dee], units: { min: 3, max: 3 } }),
  // GE options
  sec({ code: "ARLT-100", id: "34001", type: "LEC", days: ["Mon", "Wed"], start: "14:00", end: "15:20", instructors: [ada], final: FINAL_CSCI }),
  sec({ code: "GESM-110", id: "35001", type: "LEC", online: true, meetings: [], instructors: [eve] }),
  sec({ code: "PHIL-140", id: "36001", type: "LEC", dClearance: true, days: ["Mon", "Wed"], start: "16:00", end: "17:20", instructors: [ada] }),
  sec({ code: "MUSC-101", id: "37001", type: "LEC", days: ["Fri"], start: "15:00", end: "16:50", instructors: [ada], isFull: true, seats: { registered: 55, total: 50 }, units: { min: 2, max: 4 } }),
  sec({ code: "AHIS-120", id: "38001", type: "LEC", days: ["Mon", "Wed", "Fri"], start: "08:00", end: "08:50", instructors: [bob] }),
  sec({ code: "CSCI-270", id: "40001", type: "LEC", days: ["Tue", "Thu"], start: "16:30", end: "17:50", instructors: [ada] }),
  sec({ code: "PHRD-101", id: "39001", type: "LEC", campus: "HSC", days: ["Tue", "Thu"], start: "10:00", end: "11:20", instructors: [unmatched] }),
];

export const fixture: TermData = {
  term: { code: "20271", name: "Spring 2027", scrapedAt: "2026-11-14T08:00:00Z" },
  courses: Object.fromEntries(
    [
      course({ code: "CSCI-201", linkage: "coded", prereqText: "Prerequisite: CSCI 104", sectionIds: ["30001", "30002", "30003", "30004", "30005", "30006"] }),
      course({ code: "MATH-226", linkage: "single", sectionIds: ["31001", "31002", "31003"] }),
      course({ code: "WRIT-150", linkage: "coded", sectionIds: ["32001", "32002", "32003", "32004", "32005"] }),
      course({ code: "AME-101", linkage: "single", units: { min: 3, max: 3 }, crossListedWith: ["ISE-101"], sectionIds: ["33001"] }),
      course({ code: "ARLT-100", linkage: "single", ge: ["GE-B"], sectionIds: ["34001"] }),
      course({ code: "GESM-110", linkage: "single", ge: ["GE-B"], sectionIds: ["35001"] }),
      course({ code: "PHIL-140", linkage: "single", ge: ["GE-B"], sectionIds: ["36001"] }),
      course({ code: "MUSC-101", linkage: "single", ge: ["GE-B"], units: { min: 2, max: 4 }, sectionIds: ["37001"] }),
      course({ code: "AHIS-120", linkage: "single", ge: ["GE-B"], sectionIds: ["38001"] }),
      course({ code: "CSCI-270", linkage: "single", sectionIds: ["40001"] }),
      course({ code: "PHRD-101", linkage: "single", sectionIds: ["39001"] }),
      course({ code: "EMPT-100", linkage: "single", sectionIds: [] }),
    ].map((c) => [c.code, c]),
  ),
  sections: Object.fromEntries(sections.map((s) => [s.id, s])),
  rmp: {
    "1001": { legacyId: "1001", first: "Ada", last: "Lovelace", department: "CS", avg: 4.6, difficulty: 3, count: 50, wouldTakeAgain: 95 },
    "1002": { legacyId: "1002", first: "Bob", last: "Low", department: "CS", avg: 2.1, difficulty: 4, count: 30, wouldTakeAgain: 20 },
    "1003": { legacyId: "1003", first: "Cy", last: "Few", department: "Writing", avg: 4.9, difficulty: 2, count: 1, wouldTakeAgain: null },
    "1004": { legacyId: "1004", first: "Dana", last: "Init", department: "AME", avg: 4.0, difficulty: 3, count: 12, wouldTakeAgain: 80 },
    "1005": { legacyId: "1005", first: "Eve", last: "Mid", department: "Math", avg: 3.6, difficulty: 3, count: 20, wouldTakeAgain: 60 },
  },
};

const WEEK: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function allowAll(start = "08:00", end = "22:00", weekends = false): Record<Day, { start: string; end: string }[]> {
  const out = {} as Record<Day, { start: string; end: string }[]>;
  for (const d of WEEK) out[d] = d === "Sat" || d === "Sun" ? (weekends ? [{ start, end }] : []) : [{ start, end }];
  return out;
}

export function request(over: Omit<Partial<ScheduleRequest>, "preferences"> & { preferences?: Partial<Preferences> } = {}): ScheduleRequest {
  return {
    required: [],
    flexSlots: [],
    allowedTimes: allowAll(),
    unitCap: null,
    minRmp: null,
    importance: { rmp: 5, daySpread: 5, breaks: 5, seatRisk: 5, finals: 5 },
    ...over,
    preferences: {
      daySpread: "neutral",
      breaks: "neutral",
      maxGapMinutes: null,
      preferredDaysOff: [],
      comfortStart: null,
      comfortEnd: null,
      notes: null,
      ...(over.preferences ?? {}),
    },
  };
}

/** Read-only helpers for describing a RankedSchedule against its TermData. */
import type { Day, RankedSchedule, RmpTeacher, Section, SectionType, TermData } from "./contract-types";
import { DAYS, fmtMeeting, toMin } from "./time";

export function isLectureType(type: SectionType): boolean {
  return type === "LEC" || type === "LEC-LAB" || type === "LEC-DIS";
}

export const SECTION_TYPE_LABEL: Record<SectionType, string> = {
  LEC: "Lecture",
  DIS: "Discussion",
  LAB: "Lab",
  QZ: "Quiz",
  "LEC-LAB": "Lecture-Lab",
  "LEC-DIS": "Lecture-Discussion",
  OTHER: "Section",
};

export interface SectionRmp {
  teacher: RmpTeacher;
  match: "exact" | "initial";
}

/** RMP record of the first rated instructor on a section, if any. */
export function sectionRmp(data: TermData, section: Section): SectionRmp | null {
  for (const ins of section.instructors) {
    if (ins.rmpId && ins.rmpMatch && data.rmp[ins.rmpId]) return { teacher: data.rmp[ins.rmpId], match: ins.rmpMatch };
  }
  return null;
}

export function instructorNames(section: Section): string {
  if (section.instructors.length === 0) return "Instructor TBA";
  return section.instructors.map((i) => `${i.first} ${i.last}`.trim()).join(", ");
}

export interface PlacedMeeting {
  day: Day;
  start: number; // minutes from midnight
  end: number;
  sectionId: string;
  courseCode: string;
  type: SectionType;
}

export interface ScheduleSection {
  courseCode: string;
  section: Section;
}

export function scheduleSections(data: TermData, sched: RankedSchedule): ScheduleSection[] {
  const out: ScheduleSection[] = [];
  for (const c of sched.courses) {
    for (const id of c.sectionIds) {
      const section = data.sections[id];
      if (section) out.push({ courseCode: c.courseCode, section });
    }
  }
  return out;
}

export function placedMeetings(data: TermData, sched: RankedSchedule): PlacedMeeting[] {
  const out: PlacedMeeting[] = [];
  for (const { courseCode, section } of scheduleSections(data, sched)) {
    for (const m of section.meetings) {
      for (const day of m.days) {
        out.push({ day, start: toMin(m.start), end: toMin(m.end), sectionId: section.id, courseCode, type: section.type });
      }
    }
  }
  return out;
}

export interface ScheduleStats {
  daysUsed: Day[];
  earliest: number | null;
  latest: number | null;
  /** Longest gap between consecutive classes on one day, minutes. */
  maxGap: number;
  /** Sum of all between-class gaps across the week, minutes. */
  totalGap: number;
  /** Mean RMP average over rated lecture instructors. */
  avgRmp: number | null;
  ratedLectures: number;
  untimedSections: number;
}

export function scheduleStats(data: TermData, sched: RankedSchedule): ScheduleStats {
  const placed = placedMeetings(data, sched);
  const byDay = new Map<Day, PlacedMeeting[]>();
  for (const p of placed) {
    const list = byDay.get(p.day) ?? [];
    list.push(p);
    byDay.set(p.day, list);
  }
  let maxGap = 0;
  let totalGap = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const gap = Math.max(0, list[i].start - list[i - 1].end);
      maxGap = Math.max(maxGap, gap);
      totalGap += gap;
    }
  }
  const ratings: number[] = [];
  let untimedSections = 0;
  for (const { section } of scheduleSections(data, sched)) {
    if (section.meetings.length === 0) untimedSections++;
    if (isLectureType(section.type)) {
      const r = sectionRmp(data, section);
      if (r && r.match === "exact") ratings.push(r.teacher.avg);
    }
  }
  return {
    daysUsed: DAYS.filter((d) => byDay.has(d)),
    earliest: placed.length ? Math.min(...placed.map((p) => p.start)) : null,
    latest: placed.length ? Math.max(...placed.map((p) => p.end)) : null,
    maxGap,
    totalGap,
    avgRmp: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    ratedLectures: ratings.length,
    untimedSections,
  };
}

/** One-line plain-text description sent to the AI `explain` function. */
export function displayString(data: TermData, sched: RankedSchedule): string {
  return sched.courses
    .map((c) => {
      const parts = c.sectionIds.map((id) => {
        const sec = data.sections[id];
        if (!sec) return id;
        const when = sec.meetings.length ? sec.meetings.map((m) => fmtMeeting(m, true)).join(" & ") : sec.online ? "online" : "TBA";
        const rmp = isLectureType(sec.type) ? sectionRmp(data, sec) : null;
        const who = isLectureType(sec.type) && sec.instructors.length ? `, ${sec.instructors[0].last}${rmp ? ` RMP ${rmp.teacher.avg.toFixed(1)}` : ""}` : "";
        return `${sec.type} ${when}${who}`;
      });
      return `${c.courseCode}: ${parts.join("; ")}`;
    })
    .join(" | ");
}

const GE_NAMES: Record<string, string> = {
  A: "The Arts",
  B: "Humanistic Inquiry",
  C: "Social Analysis",
  D: "Life Sciences",
  E: "Physical Sciences",
  F: "Quantitative Reasoning",
  G: "Citizenship in a Diverse World",
  H: "Traditions and Historical Foundations",
};

// Public USC catalog prefixes (Fall2015OrLater). Keep these values intact for
// AI catalog queries; only translate their presentation.
const GE_LETTERS: Record<string, string> = {
  ARTS: "A", HINQ: "B", SANA: "C", LIFE: "D", PSC: "E", QREA: "F", GPG: "G", GPH: "H",
};
const OTHER_GE_NAMES: Record<string, string> = {
  DCL: "Dornsife Core Literacy",
  GESM: "General Education Seminar",
};

function geLetter(code: string): string | undefined {
  const normalized = code.trim().toUpperCase();
  return GE_LETTERS[normalized] ?? /^(?:GE[-\s]?)?([A-H])$/.exec(normalized)?.[1];
}

/** Friendly labels for both live catalog prefixes and sample letter codes. */
export function geLabel(code: string): string {
  const letter = geLetter(code);
  if (letter) return `GE-${letter} — ${GE_NAMES[letter]}`;
  return OTHER_GE_NAMES[code.trim().toUpperCase()] ?? code;
}

export function geShort(code: string): string {
  const letter = geLetter(code);
  return letter ? `GE-${letter}` : OTHER_GE_NAMES[code.trim().toUpperCase()] ?? code;
}

/** Original category values, with GE-A through GE-H first in letter order. */
export function geCategories(data: TermData): string[] {
  const set = new Set<string>();
  for (const c of Object.values(data.courses)) for (const g of c.ge) set.add(g);
  return [...set].sort((a, b) => {
    const aLetter = geLetter(a);
    const bLetter = geLetter(b);
    if (aLetter && bLetter) return aLetter.localeCompare(bLetter);
    if (aLetter) return -1;
    if (bLetter) return 1;
    return geLabel(a).localeCompare(geLabel(b));
  });
}

export function unitsLabel(units: { min: number; max: number }): string {
  return units.min === units.max ? `${units.min}` : `${units.min}-${units.max}`;
}

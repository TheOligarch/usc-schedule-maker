/**
 * Step 1 section pins: which sections a required course can be pinned to, per component
 * (lecture, lab, discussion, quiz), using the engine's own linkage rules so only
 * registrable linked combinations are offered.
 */
import { linkCombos } from "../../../engine/src/linkage";
import type { Section, SectionType, TermData } from "./contract-types";
import { isLectureType } from "./schedule";

export type PinGroup = "lecture" | Exclude<SectionType, "LEC" | "LEC-LAB" | "LEC-DIS">;
const GROUP_ORDER: PinGroup[] = ["lecture", "LAB", "DIS", "QZ", "OTHER"];
const GROUP_LABEL: Record<PinGroup, string> = { lecture: "Lecture", LAB: "Lab", DIS: "Discussion", QZ: "Quiz", OTHER: "Other component" };

export function pinGroupOf(type: SectionType): PinGroup {
  return isLectureType(type) ? "lecture" : (type as PinGroup);
}
export function pinGroupLabel(group: PinGroup): string {
  return GROUP_LABEL[group];
}

const squash = (code: string) => code.toUpperCase().replace(/[\s_-]+/g, "");

/**
 * The term's own code for a course typed or saved in another format ("csci 201",
 * "CSCI201", "GESM-120G", or a cross-listed alias), or null when the term does not offer it.
 */
export function canonicalCourseCode(data: TermData, code: string): string | null {
  if (data.courses[code]) return code;
  const want = squash(code);
  for (const c of Object.keys(data.courses)) if (squash(c) === want) return c;
  for (const c of Object.values(data.courses)) if (c.crossListedWith.some((x) => squash(x) === want)) return c.code;
  return null;
}

/** Every published section of a course, including ones listed only under a cross-listed code. */
export function courseSections(data: TermData, code: string): Section[] {
  const course = data.courses[code];
  const seen = new Set<string>();
  const out: Section[] = [];
  const add = (s: Section | undefined) => {
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  };
  for (const id of course?.sectionIds ?? []) add(data.sections[id]);
  for (const s of Object.values(data.sections)) if (s.courseCodes.includes(code) || course?.crossListedWith.some((x) => s.courseCodes.includes(x))) add(s);
  return out;
}

/** Registrable linked combinations for a course (section id lists). */
export function courseCombos(data: TermData, code: string): string[][] {
  const course = data.courses[code] ?? null;
  return linkCombos(course, courseSections(data, code)).combos.map((c) => c.map((s) => s.id));
}

export interface PinChoice {
  group: PinGroup;
  label: string;
  /** the pinned section of this component, if any */
  pinned: string | null;
  /** sections of this component that form a valid combination with the other pins */
  options: Section[];
}

export interface PinView {
  groups: PinChoice[];
  /** pinned ids the term no longer publishes for this course */
  stale: string[];
  /** true when the pins (taken together) still allow at least one combination */
  valid: boolean;
  /** the course has published sections but no registrable linked combination */
  unlinkable: boolean;
}

/** What the picker shows for one course, given its current pins. */
export function pinView(data: TermData, code: string, pins: readonly string[]): PinView {
  const sections = courseSections(data, code);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const combos = courseCombos(data, code);
  const stale = pins.filter((id) => !byId.has(id));
  const live = pins.filter((id) => byId.has(id));
  const groups: PinChoice[] = [];
  for (const group of GROUP_ORDER) {
    const members = sections.filter((s) => pinGroupOf(s.type) === group);
    if (!members.length) continue;
    const pinned = live.find((id) => pinGroupOf(byId.get(id)!.type) === group) ?? null;
    const others = live.filter((id) => id !== pinned);
    const allowed = new Set<string>();
    for (const c of combos) if (others.every((id) => c.includes(id))) for (const id of c) allowed.add(id);
    groups.push({ group, label: GROUP_LABEL[group], pinned, options: members.filter((s) => allowed.has(s.id) || s.id === pinned) });
  }
  return {
    groups,
    stale,
    valid: !stale.length && combos.some((c) => live.every((id) => c.includes(id))),
    unlinkable: sections.length > 0 && combos.length === 0,
  };
}

/** Pins after choosing `id` (or clearing, with null) for one component of a course. */
export function setComponentPin(data: TermData, code: string, pins: readonly string[], group: PinGroup, id: string | null): string[] {
  const sections = new Map(courseSections(data, code).map((s) => [s.id, s]));
  const kept = pins.filter((p) => {
    const s = sections.get(p);
    return s && pinGroupOf(s.type) !== group;
  });
  if (!id) return kept;
  const next = [...kept, id];
  // Choosing a section that cannot go with another component's pin replaces that pin.
  const combos = courseCombos(data, code).filter((c) => c.includes(id));
  return next.filter((p) => p === id || combos.some((c) => c.includes(p)));
}

/** Older saved state stored one id per course. */
export function normalizePins(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length) out[code] = unique;
  }
  return out;
}

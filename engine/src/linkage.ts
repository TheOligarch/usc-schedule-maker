import type { Course, Section, SectionType } from "./types";

const LECTURE_TYPES: ReadonlySet<SectionType> = new Set(["LEC", "LEC-LAB", "LEC-DIS"]);
export function isLecture(s: Section): boolean { return LECTURE_TYPES.has(s.type); }

export interface LinkResult {
  combos: Section[][];
  /** Retained for API compatibility. Unverifiable associations are no longer guessed. */
  ambiguous: boolean;
}

function cartesian(groups: Section[][]): Section[][] {
  let out: Section[][] = [[]];
  for (const g of groups) out = out.flatMap(part => g.map(s => [...part, s]));
  return out;
}

/**
 * Associations come from USC linkCode and session, never instructor names or
 * source order. Null codes are unrestricted within the session. Require every
 * component type offered by the course, within one session; combined lectures cover their own
 * LAB/DIS. All-null, multi-lecture/component data cannot establish an association
 * and is blocked rather than inventing a registrable combination.
 */
export function linkCombos(_course: Pick<Course, "linkage"> | null, sections: Section[]): LinkResult {
  const combos: Section[][] = [];
  const sessions = new Map<string, Section[]>();
  for (const s of sections) sessions.set(s.session, [...(sessions.get(s.session) ?? []), s]);
  const courseHasLectures = sections.some(isLecture);
  const types = [...new Set(sections.filter(s => !isLecture(s)).map(s => s.type))];
  for (const secs of sessions.values()) {
    const lectures = secs.filter(isLecture);
    if (courseHasLectures && !lectures.length) continue;
    const coded = secs.some(s => !!s.linkCode);
    if (!coded && lectures.length > 1 && types.length) continue;
    const anchors = lectures.length ? lectures : secs.filter(s => s.type === secs[0].type);
    for (const anchor of anchors) {
      const groups: Section[][] = [[anchor]];
      let complete = true;
      for (const type of types) {
        if (!lectures.length && type === anchor.type) continue;
        if ((type === "LAB" && anchor.type === "LEC-LAB") || (type === "DIS" && anchor.type === "LEC-DIS")) continue;
        const candidates = secs.filter(s => s.type === type && (!s.linkCode || !anchor.linkCode || s.linkCode === anchor.linkCode));
        if (!candidates.length) { complete = false; break; }
        groups.push(candidates);
      }
      if (complete) {
        // A null-coded anchor can join a coded group, but cannot mix two codes.
        combos.push(...cartesian(groups).filter(group => new Set(group.map(s => s.linkCode).filter(Boolean)).size <= 1));
      }
    }
  }
  return { combos, ambiguous: false };
}

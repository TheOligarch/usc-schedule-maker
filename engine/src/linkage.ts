import type { Course, Section, SectionType } from "./types";

const LECTURE_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["LEC", "LEC-LAB", "LEC-DIS"]);

export function isLecture(s: Section): boolean {
  return LECTURE_TYPES.has(s.type);
}

export interface LinkResult {
  /** each entry is one registrable set of sections (one per required type) */
  combos: Section[][];
  /** pairing was guessed from section order (contract section 4) */
  ambiguous: boolean;
}

function cartesian(groups: Section[][]): Section[][] {
  let out: Section[][] = [[]];
  for (const g of groups) {
    const next: Section[][] = [];
    for (const partial of out) for (const s of g) next.push([...partial, s]);
    out = next;
  }
  return out;
}

function groupByType(sections: Section[]): Map<SectionType, Section[]> {
  const byType = new Map<SectionType, Section[]>();
  for (const s of sections) {
    const list = byType.get(s.type);
    if (list) list.push(s);
    else byType.set(s.type, [s]);
  }
  return byType;
}

/**
 * Coded / single linkage. Same non-null linkCode letter across types = taken
 * together; null linkCode = any one section of that type. For each letter, a
 * combo takes one section of every type that has that letter, falling back to
 * that type's null-coded sections; types with neither are not needed for that
 * letter. With no letters at all, it is one section of every type.
 * A letter whose combo has no lecture (while the course has lectures) is
 * not registrable and is dropped.
 */
function codedCombos(sections: Section[]): Section[][] {
  const byType = groupByType(sections);
  const hasLecture = sections.some(isLecture);
  const letters: string[] = [];
  for (const s of sections) if (s.linkCode !== null && s.linkCode !== "" && !letters.includes(s.linkCode)) letters.push(s.linkCode);

  const keys: (string | null)[] = letters.length ? letters : [null];
  const combos: Section[][] = [];
  for (const key of keys) {
    const groups: Section[][] = [];
    for (const secs of byType.values()) {
      let cand = key === null ? [] : secs.filter((s) => s.linkCode === key);
      if (!cand.length) cand = secs.filter((s) => s.linkCode === null || s.linkCode === "");
      if (cand.length) groups.push(cand);
    }
    if (!groups.length) continue;
    if (hasLecture && !groups.some((g) => isLecture(g[0]))) continue;
    combos.push(...cartesian(groups));
  }
  return combos;
}

/**
 * Ambiguous linkage: all-null codes with several lectures. Order-based guess:
 * each lecture pairs with the following non-lecture sections until the next
 * lecture (sections before the first lecture go with the first one). If a
 * lecture's group lacks a type the course has, any section of that type is
 * allowed for it so every combo is still a complete registration.
 */
function ambiguousCombos(sections: Section[]): Section[][] {
  const byType = groupByType(sections);
  const otherTypes = [...byType.keys()].filter((t) => !LECTURE_TYPES.has(t));
  const groups: { lecture: Section; rest: Section[] }[] = [];
  const leading: Section[] = [];
  for (const s of sections) {
    if (isLecture(s)) groups.push({ lecture: s, rest: [] });
    else if (groups.length) groups[groups.length - 1].rest.push(s);
    else leading.push(s);
  }
  if (groups.length) groups[0].rest.unshift(...leading);

  const combos: Section[][] = [];
  for (const g of groups) {
    const parts: Section[][] = [[g.lecture]];
    for (const t of otherTypes) {
      const mine = g.rest.filter((s) => s.type === t);
      parts.push(mine.length ? mine : byType.get(t)!);
    }
    combos.push(...cartesian(parts));
  }
  return combos;
}

/** Valid section combinations for one course (sections in course order). */
export function linkCombos(course: Pick<Course, "linkage"> | null, sections: Section[]): LinkResult {
  if (!sections.length) return { combos: [], ambiguous: false };
  const lectures = sections.filter(isLecture).length;
  if (course?.linkage === "ambiguous" && lectures > 1) {
    return { combos: ambiguousCombos(sections), ambiguous: true };
  }
  return { combos: codedCombos(sections), ambiguous: false };
}

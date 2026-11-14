// Attach final exams and RMP matches to normalized TermData.

import { type FinalsRules, finalFor, normName, type ProgramNames } from "./finals.ts";
import { RmpMatcher } from "./rmp.ts";
import type { RmpTeacher, TermData } from "./types.ts";
import { LECTURE_TYPES } from "./types.ts";
import type { RawSchool } from "./usc.ts";

export function programNames(schools: RawSchool[]): { names: ProgramNames; byPrefix: Map<string, string> } {
  const byName = new Map<string, string>();
  const byPrefix = new Map<string, string>();
  for (const s of schools) {
    for (const p of s.programs ?? []) {
      byName.set(normName(p.name), p.prefix);
      if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, p.name);
    }
  }
  return { names: { byName }, byPrefix };
}

export function applyFinals(data: TermData, rules: FinalsRules | null): number {
  let n = 0;
  for (const s of Object.values(data.sections)) {
    s.final = rules ? finalFor(s, rules) : null;
    if (s.final) n++;
  }
  return n;
}

export interface RmpStats {
  lectureInstructors: number;
  exact: number;
  initial: number;
  unmatched: number;
}

/** Only lecture instructors are rated (captain's rule); other sections keep rmpId null. */
export function applyRmp(data: TermData, teachers: RmpTeacher[], deptByPrefix: Map<string, string>): RmpStats {
  const matcher = new RmpMatcher(teachers);
  const stats: RmpStats = { lectureInstructors: 0, exact: 0, initial: 0, unmatched: 0 };
  const rmp: Record<string, RmpTeacher> = {};
  for (const s of Object.values(data.sections)) {
    if (!LECTURE_TYPES.has(s.type)) continue;
    const depts = [...new Set(s.courseCodes.map((c) => deptByPrefix.get(c.split("-")[0] ?? "") ?? ""))].filter(Boolean);
    for (const inst of s.instructors) {
      stats.lectureInstructors++;
      const m = matcher.match(inst.first, inst.last, depts);
      if (!m) {
        stats.unmatched++;
        continue;
      }
      inst.rmpId = m.teacher.legacyId;
      inst.rmpMatch = m.kind;
      stats[m.kind]++;
      rmp[m.teacher.legacyId] = m.teacher;
    }
  }
  data.rmp = Object.fromEntries(Object.entries(rmp).sort(([a], [b]) => Number(a) - Number(b)));
  return stats;
}

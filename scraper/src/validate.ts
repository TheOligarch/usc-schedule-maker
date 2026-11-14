// Sanity checks run before publishing. Any problem blocks the publish for that term.

import type { TermData } from "./types.ts";

const MIN_COURSES = 200;
const MIN_SECTIONS = 1000;
/** A new scrape with under this share of the previously published sections is treated as broken. */
const MIN_SHARE_OF_PREVIOUS = 0.6;

const HHMM = /^\d{2}:\d{2}$/;

export function validateTermData(data: TermData, previousSections: number | null): string[] {
  const problems: string[] = [];
  const courses = Object.values(data.courses);
  const sections = Object.values(data.sections);
  if (courses.length < MIN_COURSES) problems.push(`only ${courses.length} courses`);
  if (sections.length < MIN_SECTIONS) problems.push(`only ${sections.length} sections`);
  if (previousSections && sections.length < previousSections * MIN_SHARE_OF_PREVIOUS) {
    problems.push(`${sections.length} sections vs ${previousSections} last published`);
  }
  let dangling = 0;
  for (const c of courses) for (const id of c.sectionIds) if (!data.sections[id]) dangling++;
  for (const s of sections) {
    for (const code of s.courseCodes) if (!data.courses[code]?.sectionIds.includes(s.id)) dangling++;
    for (const m of s.meetings) if (!HHMM.test(m.start) || !HHMM.test(m.end) || m.days.length === 0) dangling++;
    for (const i of s.instructors) if (i.rmpId && !data.rmp[i.rmpId]) dangling++;
  }
  if (dangling) problems.push(`${dangling} broken references`);
  return problems;
}

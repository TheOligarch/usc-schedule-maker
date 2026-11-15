import type { Day, RankedSchedule, SectionType, TermData } from "./contract-types";
import { fmtTime, toMin } from "./time";

export interface Refinement {
  scheduleId: string;
  text: string;
  summary: string;
  excludedSectionIds: string[];
  rule?: { code?: string; types?: SectionType[]; day?: Day; before?: number; after?: number };
}
const DAY: Record<string, Day> = { monday: "Mon", mon: "Mon", tuesday: "Tue", tue: "Tue", wednesday: "Wed", wed: "Wed", thursday: "Thu", thu: "Thu", friday: "Fri", fri: "Fri", saturday: "Sat", sat: "Sat", sunday: "Sun", sun: "Sun" };
const TYPE: Record<string, SectionType[]> = { lab: ["LAB", "LEC-LAB"], discussion: ["DIS", "LEC-DIS"], lecture: ["LEC", "LEC-LAB", "LEC-DIS"], quiz: ["QZ"] };
const HELP = 'Try “I dont want a BISC lab on Friday”, “no classes before 10am”, or “avoid this lab on Friday”. Use one change at a time.';

/** Deterministic, local interpretation: unsupported text is never presented as applied. */
export function parseRefinement(text: string, data: TermData, schedule: RankedSchedule | null): Refinement {
  let rest = text.trim().toLowerCase().replace(/[’']/g, "").replace(/[.!?]$/g, "").replace(/\s+/g, " ");
  const negative = /^(?:i )?(?:dont want|do not want|dont want to have|avoid|no)\s+/;
  if (!negative.test(rest)) throw new Error(HELP);
  rest = rest.replace(negative, "").replace(/^(?:a|an|any|the)\s+/, "");
  const tail = /\s+(?:on\s+)?(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)$/.exec(rest);
  const clock = /\s+(before|after)\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/.exec(rest);
  let day: Day | undefined, threshold: number | undefined, direction: string | undefined;
  if (tail) { day = DAY[tail[1]]; rest = rest.slice(0, tail.index); }
  else if (clock) {
    const h = Number(clock[2]);
    if (h < 1 || h > 12) throw new Error(HELP);
    threshold = (h % 12 + (clock[4] === "pm" ? 12 : 0)) * 60 + Number(clock[3] ?? 0);
    direction = clock[1]; rest = rest.slice(0, clock.index);
  } else throw new Error(HELP);
  rest = rest.replace(/\b(labs|discussions|lectures|quizzes)\b/g, word => ({ labs: "lab", discussions: "discussion", lectures: "lecture", quizzes: "quiz" })[word]!);
  const subject = /^(?:(this|my)\s+)?(?:(\w{2,6}(?:[- ]?\d{3}[a-z]*)?)\s+)?(lab|discussion|lecture|quiz|classes|class|courses|course)$/.exec(rest);
  if (!subject) throw new Error(HELP);
  let code = subject[2]?.toUpperCase().replace(/\s+/g, "-");
  const types = TYPE[subject[3]];
  if (subject[1]) {
    const matching = (schedule?.courses ?? []).filter(c => c.sectionIds.some(id => !types || types.includes(data.sections[id]?.type)));
    if (matching.length !== 1) throw new Error("Name the course or department so I can identify which component to change. " + HELP);
    code = matching[0].courseCode;
  }
  const rule: Refinement["rule"] = { code, types, day, ...(direction === "before" ? { before: threshold } : direction === "after" ? { after: threshold } : {}) };
  const ids = matchingSections(rule, data);
  if (!ids.length) throw new Error("No published sections match that change. Check the course, component and time. " + HELP);
  const scope = `${code ? code + " " : ""}${subject[3]}`;
  return { scheduleId: schedule?.id ?? "no-feasible-schedule", text: text.trim(), summary: `Exclude ${scope} ${day ? "on " + day : direction + " " + fmtTime(threshold!)}`, excludedSectionIds: ids, rule };
}

function matchingSections(rule: NonNullable<Refinement["rule"]>, data: TermData): string[] {
  const { code, types, day, before, after } = rule;
  const matchesCode = (candidate: string) => !code || candidate.replace(/-/g, "") === code.replace(/-/g, "") || candidate.split("-")[0] === code;
  return Object.values(data.sections).filter(s => s.courseCodes.some(matchesCode) && (!types || types.includes(s.type)) && s.meetings.some(m =>
    day ? m.days.includes(day) : before !== undefined ? toMin(m.start) < before : after !== undefined && toMin(m.end) > after)).map(s => s.id);
}

/** Recompile saved rules against a newer catalog so newly published sections obey them too. */
export function refinementSectionIds(refinement: Refinement, data?: TermData): string[] {
  return data && refinement.rule ? matchingSections(refinement.rule, data) : refinement.excludedSectionIds;
}

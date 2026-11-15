import { linkCombos } from "../../../engine/src/linkage";
import type { Course, InterviewQuestion, InterviewRequest, InterviewResponse, TermData } from "./contract-types";

/** Stable categories shared by the live-service and offline interview boundaries. */
export const ELECTIVE_CATEGORIES: Record<string, { words: string[]; departments: string[] }> = {
  "Arts, film & music": { words: ["art", "film", "cinema", "music", "theatre", "design", "dance"], departments: ["ART", "AHIS", "CTCS", "CTPR", "MUSC", "THTR", "DANC", "DES"] },
  "People, culture & history": { words: ["society", "social", "psycholog", "culture", "histor", "religio", "philosoph", "language"], departments: ["PSYC", "SOCI", "HIST", "ANTH", "PHIL", "REL"] },
  "Science, nature & health": { words: ["biolog", "environment", "health", "nature", "earth", "physic", "chemistry", "neuroscience"], departments: ["BISC", "CHEM", "PHYS", "ENST", "GEOL", "HP", "HBIO", "PHRD"] },
  "Technology, math & engineering": { words: ["technology", "comput", "programming", "data", "engineer", "math", "software", "robot"], departments: ["CSCI", "ITP", "MATH", "AME", "EE", "ISE"] },
  "Business, law & public policy": { words: ["business", "law", "politic", "policy", "economic", "finance", "entrepreneur"], departments: ["BUAD", "BAEP", "ECON", "POSC", "PPD", "LAW", "FBE"] },
};

function questionSlots(id: string, slots: InterviewRequest["slots"]): number[] {
  if (id === "interests") return slots.map((_, i) => i);
  const m = /^slots-(\d+(?:-\d+)*)$/.exec(id);
  return m ? m[1].split("-").map(Number) : [];
}
export function isElectiveQuestion(q: InterviewQuestion): boolean {
  return q.options.length === Object.keys(ELECTIVE_CATEGORIES).length && q.options.every(o => o in ELECTIVE_CATEGORIES);
}
export function selectedCategories(req: Pick<InterviewRequest, "slots" | "history">, slotIndex: number): string[] {
  const answer = req.history.find(h => questionSlots(h.questionId, req.slots).includes(slotIndex));
  const text = `${answer?.answer ?? ""} ${answer?.freeText ?? ""}`;
  return Object.keys(ELECTIVE_CATEGORIES).filter(label => text.includes(label));
}
export function electiveInterestScore(c: Course, labels: string[]): number {
  const text = `${c.title} ${c.description ?? ""}`.toLowerCase();
  const prefix = c.code.split("-")[0];
  let hits = 0;
  for (const label of labels) {
    const category = ELECTIVE_CATEGORIES[label];
    if (!category) continue;
    hits += category.departments.includes(prefix) ? 3 : 0;
    hits += category.words.filter(w => new RegExp(`\\b${w}`).test(text)).length;
  }
  return Math.min(1, hits / 4);
}

/** Keep the deployed service's topic IDs/history, but guarantee category choices and real local candidates. */
export function withElectiveInterests(req: InterviewRequest, res: InterviewResponse, data: TermData): InterviewResponse {
  if (!req.slots?.some(s => s.kind === "elective")) return res;
  if (!res.done) {
    const electiveSlots = questionSlots(res.question.id, req.slots).filter(i => req.slots[i]?.kind === "elective");
    if (!electiveSlots.length) return res;
    return { done: false, question: { ...res.question, text: `Which areas would you like to explore for ${electiveSlots.map(i => req.slots[i].label).join(" and ")}? Choose one or more, or describe your interests.`, options: Object.keys(ELECTIVE_CATEGORIES) } };
  }
  const used = new Set([...req.required, ...res.shortlists.filter(s => req.slots.find(slot => slot.label === s.label)?.kind !== "elective").flatMap(s => s.options.map(o => o.courseCode))]);
  const notes: string[] = [];
  const shortlists = res.shortlists.map(list => {
    const slotIndex = req.slots.findIndex(s => s.label === list.label);
    if (req.slots[slotIndex]?.kind !== "elective") return list;
    const labels = selectedCategories(req, slotIndex);
    if (!labels.length) { for (const option of list.options) used.add(option.courseCode); return list; }
    const options = Object.values(data.courses).filter(c => !used.has(c.code) && !c.crossListedWith.some(code => used.has(code)) && linkCombos(c, c.sectionIds.map(id => data.sections[id]).filter(Boolean)).combos.length > 0)
      .map(c => ({ c, score: electiveInterestScore(c, labels) })).filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code)).slice(0, 5)
      .map(({ c }) => ({ courseCode: c.code, reason: `Matches your selected areas: ${labels.join("; ")}.` }));
    for (const o of options) used.add(o.courseCode);
    notes.push(`${list.label} interests: ${labels.join("; ")}.${options.length ? "" : " No matching published courses; edit this shortlist or change interests."}`);
    return { ...list, options };
  });
  return { ...res, shortlists, summary: [...res.summary, ...notes] };
}

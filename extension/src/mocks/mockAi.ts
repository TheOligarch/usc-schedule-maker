/**
 * Stand-in for the Supabase Edge Functions `interview` and `explain` (usm-ai).
 * A scripted, deterministic interview that still produces real shortlists from the
 * loaded term data. The real functions replace it through src/lib/ai.ts.
 */
import type {
  Day,
  ExplainRequest,
  ExplainResponse,
  InterviewHistoryItem,
  InterviewQuestion,
  InterviewRequest,
  InterviewResponse,
  Preferences,
  Shortlist,
  TermData,
} from "../lib/contract-types";
import { MAX_SHORTLIST } from "../lib/config";
import { geShort, isLectureType, sectionRmp } from "../lib/schedule";

interface Scripted extends InterviewQuestion {
  needsSlots?: boolean;
}

const INTERESTS: Record<string, string[]> = {
  "Film, media & games": ["cinema", "film", "movie", "media", "game", "interactive", "entertainment", "novel"],
  "Tech & data": ["technology", "data", "web", "software", "machine", "language and technology", "programming", "comput"],
  "People & society": ["psycholog", "sociolog", "social", "behavior", "race", "class", "cities", "leadership", "economic"],
  "History & culture": ["histor", "ancient", "medieval", "religio", "tradition", "culture", "greek", "world"],
  "Science & nature": ["universe", "planet", "earth", "physiolog", "body", "physics", "stars", "geolog"],
  "Music & arts": ["music", "theatre", "drama", "art", "stage", "cinema"],
};

const SCRIPT: Scripted[] = [
  { id: "interests", text: "For your open GE and elective slots, what sounds most interesting right now?", options: Object.keys(INTERESTS), allowFreeText: true, needsSlots: true },
  { id: "workload", text: "How difficult should those open-slot classes be?", options: ["Easy", "Moderate", "Challenging"], allowFreeText: true, needsSlots: true },
  { id: "format", text: "What kind of class do you learn best in?", options: ["Big lectures are fine", "Small and discussion-based", "Hands-on labs and projects", "No preference"], allowFreeText: true, needsSlots: true },
  { id: "daySpread", text: "How do you like your week laid out?", options: ["Stack classes on as few days as possible", "Spread them evenly across the week", "No strong preference"], allowFreeText: true },
  { id: "dayOff", text: "If you could keep one day free of classes, which would it be?", options: ["Friday", "Monday", "Any day works", "I don't need a day off"], allowFreeText: true },
  { id: "breaks", text: "On a class day, do you want classes back-to-back or with breathing room?", options: ["Back-to-back, get it done", "Short breaks between classes", "Long gaps are fine", "No preference"], allowFreeText: true },
  { id: "maxGap", text: "What is the longest gap between two classes you would tolerate?", options: ["1 hour", "2 hours", "3 hours", "Doesn't matter"], allowFreeText: true },
  { id: "anythingElse", text: "Last one: anything else the ranking should favor?", options: ["Great professors above all", "Open seats - I register late", "A free lunch hour", "Nope, that's everything"], allowFreeText: true },
];

function answerOf(history: InterviewHistoryItem[], id: string): string {
  const item = history.find((h) => h.questionId === id);
  return item ? `${item.answer} ${item.freeText ?? ""}`.trim() : "";
}

function derivePreferences(history: InterviewHistoryItem[]): Preferences {
  const spread = answerOf(history, "daySpread");
  const breaks = answerOf(history, "breaks");
  const gap = answerOf(history, "maxGap");
  const off = answerOf(history, "dayOff");
  const notes = history
    .map((h) => h.freeText?.trim())
    .filter((x): x is string => Boolean(x))
    .join(" ");
  const preferredDaysOff: Day[] = off.startsWith("Friday") ? ["Fri"] : off.startsWith("Monday") ? ["Mon"] : [];
  return {
    daySpread: spread.startsWith("Stack") ? "compact" : spread.startsWith("Spread") ? "spread" : "neutral",
    breaks: breaks.startsWith("Back") ? "avoid" : breaks.startsWith("Short") || breaks.startsWith("Long") ? "prefer" : "neutral",
    maxGapMinutes: gap.startsWith("1") ? 60 : gap.startsWith("2") ? 120 : gap.startsWith("3") ? 180 : null,
    preferredDaysOff,
    // Start and end times come from the allowed-times calendar, so the interview does not ask.
    comfortStart: null,
    comfortEnd: null,
    notes: notes || null,
  };
}

function buildShortlists(req: InterviewRequest, data: TermData): Shortlist[] {
  const interest = answerOf(req.history, "interests");
  const keywords = Object.entries(INTERESTS)
    .filter(([label]) => interest.includes(label))
    .flatMap(([, words]) => words);
  const freeWords = interest
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((wd) => wd.length > 4);
  const workload = answerOf(req.history, "workload");
  const format = answerOf(req.history, "format");
  const taken = new Set(req.required);

  return req.slots.map((slot) => {
    const pool = Object.values(data.courses).filter((c) => {
      if (taken.has(c.code) || c.crossListedWith.some((x) => taken.has(x))) return false;
      if (c.sectionIds.length === 0) return false;
      if (slot.kind === "GE") return slot.geCategory ? c.ge.includes(slot.geCategory) : c.ge.length > 0;
      return true;
    });
    const scored = pool.map((c) => {
      const text = `${c.title} ${c.description ?? ""}`.toLowerCase();
      const hits = [...keywords, ...freeWords].filter((k) => text.includes(k));
      const lectures = c.sectionIds.map((id) => data.sections[id]).filter((sec) => sec && isLectureType(sec.type));
      const ratings = lectures.map((sec) => sectionRmp(data, sec)).filter((r) => r !== null);
      const best = ratings.length ? Math.max(...ratings.map((r) => r.teacher.avg)) : null;
      const easiest = ratings.length ? Math.min(...ratings.map((r) => r.teacher.difficulty)) : null;
      const hasDiscussion = c.sectionIds.some((id) => data.sections[id]?.type === "DIS");
      const hasLab = c.sectionIds.some((id) => ["LAB", "LEC-LAB"].includes(data.sections[id]?.type ?? ""));
      let score = hits.length * 3 + (best ?? 3.5);
      if (workload.startsWith("Easy") && easiest !== null) score += (5 - easiest) * 0.8;
      if (workload.startsWith("Challenging") && easiest !== null) score += easiest * 0.5;
      if (format.startsWith("Small") && hasDiscussion) score += 1;
      if (format.startsWith("Hands-on") && hasLab) score += 1.5;
      if (slot.kind === "elective" && c.ge.length > 0) score -= 1;
      const reasons: string[] = [];
      if (hits.length) reasons.push(`matches your interest in ${interest.split(/[,&]/)[0].trim().toLowerCase() || "this area"}`);
      if (best !== null) reasons.push(`lecture instructor rated ${best.toFixed(1)} on RateMyProfessors`);
      if (workload.startsWith("Easy") && easiest !== null && easiest <= 2.8) reasons.push("students report a lighter workload");
      if (slot.kind === "GE" && c.ge.length) reasons.push(`counts for ${c.ge.map(geShort).join(", ")}`);
      if (!reasons.length) reasons.push("fits this slot and has open sections");
      const reason = reasons.join("; ");
      return { c, score, reason: reason.charAt(0).toUpperCase() + reason.slice(1) + "." };
    });
    scored.sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code));
    const options = scored.slice(0, MAX_SHORTLIST).map(({ c, reason }) => ({ courseCode: c.code, reason }));
    for (const o of options) taken.add(o.courseCode);
    return { label: slot.label, options };
  });
}

function buildSummary(prefs: Preferences, history: InterviewHistoryItem[], hasSlots: boolean): string[] {
  const out: string[] = [];
  if (hasSlots && answerOf(history, "interests")) out.push(`Open slots: leaning toward ${history.find((h) => h.questionId === "interests")!.answer.toLowerCase()}.`);
  out.push(
    prefs.daySpread === "compact"
      ? "Stack classes onto as few days as possible."
      : prefs.daySpread === "spread"
        ? "Spread classes evenly across the week."
        : "No strong preference on how classes spread across the week.",
  );
  if (prefs.preferredDaysOff.length) out.push(`Would love ${prefs.preferredDaysOff.join(" and ")} free of classes.`);
  out.push(
    prefs.breaks === "avoid" ? "Prefers back-to-back classes with little downtime." : prefs.breaks === "prefer" ? "Prefers breathing room between classes." : "Fine with or without breaks between classes.",
  );
  if (prefs.maxGapMinutes !== null) out.push(`Gaps between classes should stay under ${prefs.maxGapMinutes / 60} hour${prefs.maxGapMinutes === 60 ? "" : "s"}.`);
  if (prefs.comfortStart) out.push(`Ideally no class before ${prefs.comfortStart === "10:00" ? "10 AM" : "noon"}.`);
  if (prefs.comfortEnd) out.push(`Ideally done by ${prefs.comfortEnd === "16:00" ? "4 PM" : "6 PM"}.`);
  const extra = history.find((h) => h.questionId === "anythingElse");
  if (extra && !extra.answer.startsWith("Nope")) out.push(`Also favors: ${extra.answer.toLowerCase()}.`);
  if (prefs.notes) out.push(`In your words: "${prefs.notes}"`);
  return out;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mockInterview(req: InterviewRequest, data: TermData): Promise<InterviewResponse> {
  await delay(350);
  const hasSlots = req.slots.length > 0;
  const asked = new Set(req.history.map((h) => h.questionId));
  const next = SCRIPT.find((q) => !asked.has(q.id) && (hasSlots || !q.needsSlots));
  if (next && req.history.length < 10) {
    return { done: false, question: { id: next.id, text: next.text, options: next.options, allowFreeText: true } };
  }
  const preferences = derivePreferences(req.history);
  return { done: true, preferences, shortlists: buildShortlists(req, data), summary: buildSummary(preferences, req.history, hasSlots) };
}

export async function mockExplain(req: ExplainRequest): Promise<ExplainResponse> {
  await delay(500);
  const best = req.schedules[0]?.score ?? 0;
  return {
    explanations: req.schedules.map((sched, i) => {
      const heavy = sched.penalties.filter((p) => p.kind !== "preference" && p.kind !== "noRmp");
      const soft = sched.penalties.filter((p) => p.kind === "preference");
      const first =
        i === 0
          ? "Your best overall match"
          : best - sched.score < 3
            ? "Nearly as strong as the top pick"
            : `Ranks #${i + 1}`;
      const good: string[] = [];
      if (heavy.length === 0) good.push("every section has open seats and a set meeting time");
      if (soft.length === 0) good.push("it lines up with everything you told the interview");
      // Lower-case a leading word ("Classes on 5 days") but never a course code ("CSCI-270 ...").
      const bad = [...heavy, ...soft].slice(0, 2).map((p) => (/^[A-Z][a-z]/.test(p.message) ? p.message.charAt(0).toLowerCase() + p.message.slice(1) : p.message));
      const s1 = good.length ? `${first}: ${good.join(", and ")}.` : `${first} at ${sched.units} units.`;
      const s2 = bad.length ? ` Trade-off${bad.length > 1 ? "s" : ""}: ${bad.join("; ")}.` : "";
      return { id: sched.id, text: s1 + s2 };
    }),
  };
}

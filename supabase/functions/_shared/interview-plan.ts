// The interview's shape, decided in code rather than by the model: which topics
// are asked, in what order, and how they fit in the 10-question budget. Also the
// built-in questions and answer parsing used when the model is unavailable.
import { Day, DAYS, HHMM, HistoryItem, InterviewRequest, MAX_QUESTIONS, Preferences, Question, Slot } from "./types.ts";

export type CoreKind =
  | "day-spread"
  | "breaks"
  | "max-gap"
  | "breaks-and-gap"
  | "days-off";

export type Topic =
  | { id: string; kind: CoreKind; goal: string }
  | { id: string; kind: "slots"; goal: string; slotIndexes: number[] };

const CORE_GOALS: Record<CoreKind, string> = {
  "day-spread": "Whether they want classes stacked on as few days as possible or spread across the week.",
  "breaks": "Whether they want classes back-to-back or with breaks in between on the same day.",
  "max-gap": "The longest gap between two classes on the same day they would accept.",
  "breaks-and-gap": "Whether they want back-to-back classes or breaks, and the longest gap they would accept.",
  "days-off": "Which weekdays, if any, they would like to keep free of classes.",
};

function coreKinds(slotCount: number): CoreKind[] {
  // Start and end times come from the student's allowed-times calendar, so they are never asked.
  // Merge the break questions once open slots would otherwise take the whole budget.
  if (slotCount <= MAX_QUESTIONS - 4) return ["day-spread", "breaks", "max-gap", "days-off"];
  return ["day-spread", "breaks-and-gap", "days-off"];
}

/** Splits slot indexes into at most `groups` consecutive, evenly sized groups. */
function groupSlots(count: number, groups: number): number[][] {
  const out: number[][] = [];
  const n = Math.min(count, groups);
  for (let g = 0; g < n; g++) {
    const from = Math.floor((g * count) / n);
    const to = Math.floor(((g + 1) * count) / n);
    out.push(Array.from({ length: to - from }, (_, i) => from + i));
  }
  return out;
}

/** Every topic the interview covers, in asking order; never more than MAX_QUESTIONS. */
export function buildPlan(slots: Slot[]): Topic[] {
  const core = coreKinds(slots.length);
  const topics: Topic[] = core.map((kind) => ({ id: kind, kind, goal: CORE_GOALS[kind] }));
  for (const slotIndexes of groupSlots(slots.length, MAX_QUESTIONS - core.length)) {
    const labels = slotIndexes.map((i) => `"${slots[i].label}"`).join(" and ");
    topics.push({
      id: `slots-${slotIndexes.join("-")}`,
      kind: "slots",
      slotIndexes,
      goal: `Their general interests for the open course slot${slotIndexes.length > 1 ? "s" : ""} ${labels}, so courses can be shortlisted.`,
    });
  }
  return topics;
}

/**
 * Topics still to ask. The client only echoes history, so position is derived from
 * the furthest topic already asked: anything before it was either asked or skipped
 * on purpose and is never asked again.
 */
export function remainingTopics(plan: Topic[], history: HistoryItem[]): Topic[] {
  let furthest = -1;
  for (const item of history) {
    furthest = Math.max(furthest, plan.findIndex((t) => t.id === item.questionId));
  }
  const start = furthest >= 0 ? furthest + 1 : Math.min(history.length, plan.length);
  return plan.slice(start).slice(0, Math.max(0, MAX_QUESTIONS - history.length));
}

// ---------- time helpers ----------

export function toMinutes(t: HHMM): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

export function fromMinutes(mins: number): HHMM {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(mins)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function to12h(t: HHMM): string {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Finds clock times written like "10:00 AM", "9am", "noon" or "14:30", in order. */
export function parseTimes(text: string): HHMM[] {
  const out: HHMM[] = [];
  const re = /\b(noon|midnight)\b|\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  for (const m of text.matchAll(re)) {
    if (m[1]) {
      out.push(m[1].toLowerCase() === "noon" ? "12:00" : "00:00");
    } else if (m[2]) {
      const h = Number(m[2]);
      if (h < 1 || h > 12) continue;
      const pm = m[4].toLowerCase().startsWith("p");
      out.push(fromMinutes(((h % 12) + (pm ? 12 : 0)) * 60 + Number(m[3] ?? 0)));
    } else {
      out.push(fromMinutes(Number(m[5]) * 60 + Number(m[6])));
    }
  }
  return out;
}

// ---------- built-in questions (used when the model cannot answer) ----------

export function fallbackQuestion(topic: Topic, req: InterviewRequest): Question {
  const q = (text: string, options: string[]): Question => ({ id: topic.id, text, options, allowFreeText: true });

  switch (topic.kind) {
    case "day-spread":
      return q("How would you like your classes spread across the week?", [
        "Stack them on as few days as possible",
        "Spread them evenly across the week",
        "No strong preference",
      ]);
    case "breaks":
      return q("How do you feel about breaks between classes on the same day?", [
        "Back-to-back, as few breaks as possible",
        "I like breaks between classes",
        "No strong preference",
      ]);
    case "max-gap":
      return q("What is the longest gap between classes you would be okay with?", [
        "30 minutes",
        "1 hour",
        "2 hours",
        "3 hours",
        "No limit",
      ]);
    case "breaks-and-gap":
      return q("How do you feel about gaps between classes on the same day?", [
        "Back-to-back, no gap over 30 minutes",
        "Short breaks, no gap over 1 hour",
        "Longer breaks are fine, up to 2 hours",
        "No strong preference",
      ]);
    case "days-off":
      return q("Is there a day you would love to keep free of classes?", [
        "Friday",
        "Monday",
        "Monday and Friday",
        "No day off needed",
      ]);
    case "slots": {
      const labels = topic.slotIndexes.map((i) => req.slots[i].label).join(" and ");
      return q(`What kind of topics interest you for ${labels}?`, [
        "Arts, film and music",
        "History, culture and society",
        "Science, technology and environment",
        "Business, law and politics",
        "Surprise me",
      ]);
    }
  }
}

// ---------- preference parsing without the model ----------

const DAY_WORDS: [RegExp, Day][] = [
  [/\bmon(day)?s?\b/i, "Mon"],
  [/\btue(s|sday)?s?\b/i, "Tue"],
  [/\bwed(nesday)?s?\b/i, "Wed"],
  [/\bthu(r|rs|rsday)?s?\b/i, "Thu"],
  [/\bfri(day)?s?\b/i, "Fri"],
  [/\bsat(urday)?s?\b/i, "Sat"],
  [/\bsun(day)?s?\b/i, "Sun"],
];

function parseGapMinutes(text: string): number | null {
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hour)/i);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const mins = text.match(/(\d+)\s*min/i);
  return mins ? Number(mins[1]) : null;
}

/** The interest text a student gave for one slot, from the question that covered it. */
export function slotInterest(plan: Topic[], history: HistoryItem[], slotIndex: number): string {
  const topic = plan.find((t) => t.kind === "slots" && t.slotIndexes.includes(slotIndex));
  const item = topic && history.find((h) => h.questionId === topic.id);
  return item ? [item.answer, item.freeText].filter(Boolean).join(". ") : "";
}

/**
 * Best-effort preferences from keyword matching. Only used when the model call
 * fails; reliable for the built-in question options, rough for anything else.
 */
export function fallbackPreferences(plan: Topic[], req: InterviewRequest): Preferences {
  const prefs: Preferences = {
    daySpread: "neutral",
    breaks: "neutral",
    maxGapMinutes: null,
    preferredDaysOff: [],
    comfortStart: null,
    comfortEnd: null,
    notes: null,
  };
  const notes: string[] = [];

  for (const item of req.history) {
    const topic = plan.find((t) => t.id === item.questionId);
    const text = [item.answer, item.freeText].filter(Boolean).join(". ");
    if (item.freeText?.trim()) notes.push(item.freeText.trim());
    if (!topic || topic.kind === "slots") continue;

    if (topic.kind === "day-spread") {
      if (/few|stack|compact|pack|cluster/i.test(text)) prefs.daySpread = "compact";
      else if (/spread|even|every day|each day/i.test(text)) prefs.daySpread = "spread";
    }
    if (topic.kind === "breaks" || topic.kind === "breaks-and-gap") {
      if (/back.to.back|no break|few breaks|avoid|without break/i.test(text)) prefs.breaks = "avoid";
      else if (/break|gap|lunch|time between/i.test(text) && !/no strong|no pref/i.test(text)) prefs.breaks = "prefer";
    }
    if (topic.kind === "max-gap" || topic.kind === "breaks-and-gap") {
      prefs.maxGapMinutes = parseGapMinutes(text) ?? prefs.maxGapMinutes;
    }
    if (topic.kind === "days-off") {
      // "No day off needed" names no day, so it correctly yields none.
      prefs.preferredDaysOff = DAY_WORDS.filter(([re]) => re.test(text)).map(([, day]) => day);
    }
  }

  prefs.notes = notes.length ? notes.join(" ").slice(0, 500) : null;
  return sanitizePreferences(prefs);
}

/** Forces any preferences object (model- or rule-made) into contract-valid values. */
export function sanitizePreferences(
  raw: {
    daySpread: string;
    breaks: string;
    maxGapMinutes: number | null;
    preferredDaysOff: string[];
    comfortStart: string | null;
    comfortEnd: string | null;
    notes: string | null;
  },
): Preferences {
  const oneOf = <T extends string>(v: string, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const gap = raw.maxGapMinutes;
  const notes = raw.notes?.trim();
  return {
    daySpread: oneOf(raw.daySpread, ["compact", "neutral", "spread"] as const, "neutral"),
    breaks: oneOf(raw.breaks, ["avoid", "neutral", "prefer"] as const, "neutral"),
    maxGapMinutes: typeof gap === "number" && Number.isFinite(gap) && gap >= 0 && gap <= 720 ? Math.round(gap) : null,
    preferredDaysOff: DAYS.filter((d) => raw.preferredDaysOff.includes(d)),
    // Start and end times come from the allowed-times calendar, never the interview.
    comfortStart: null,
    comfortEnd: null,
    notes: notes ? notes.slice(0, 500) : null,
  };
}

/** Plain-language bullets describing preferences, for the no-model path. */
export function describePreferences(p: Preferences): string[] {
  const out: string[] = [];
  if (p.daySpread === "compact") out.push("You prefer classes stacked on as few days as possible.");
  if (p.daySpread === "spread") out.push("You prefer classes spread across the week.");
  if (p.breaks === "avoid") out.push("You prefer back-to-back classes with few breaks.");
  if (p.breaks === "prefer") out.push("You like having breaks between classes.");
  if (p.maxGapMinutes !== null) out.push(`You want gaps between classes to stay under ${p.maxGapMinutes} minutes.`);
  if (p.preferredDaysOff.length) out.push(`You would like ${p.preferredDaysOff.join(" and ")} free of classes.`);
  if (!out.length) out.push("You have no strong preferences about how your week is laid out.");
  return out;
}

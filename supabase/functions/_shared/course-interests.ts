// Pure helpers shared by the Edge Function and the bundled offline interview.
// Keep this module free of Deno/server dependencies so the extension can import it.
interface InterestSlot {
  label: string;
  kind: string;
  geCategory?: string;
}
interface InterestAnswer {
  questionId: string;
  answer: string;
  freeText?: string;
}

export interface CourseInterestTopic {
  id: string;
  kind: "course-interest";
  label: string;
  goal: string;
  slotIndexes: number[];
  text: string;
  options: string[];
  allowFreeText: true;
}

export function isSeminarSlot(slot: InterestSlot): boolean {
  if (slot.kind !== "GE") return false;
  return /^(?:GESM|General Education Seminar)$/i.test(slot.geCategory?.trim() ?? "") ||
    /^(?:GESM|General Education Seminar)(?: course)?(?: \d+)?$/i.test(slot.label.trim());
}

/** One question per course family, even with several GESM codes or seminar slots. */
export function courseInterestTopics(required: string[], slots: InterestSlot[]): CourseInterestTopic[] {
  const topics: CourseInterestTopic[] = [];
  const codes = required.map((code) => code.trim().toUpperCase().replace(/\s+/g, "-"));
  if (codes.some((code) => /^WRIT-150[A-Z]*$/.test(code))) {
    topics.push({
      id: "writing-interests",
      kind: "course-interest",
      label: "WRIT-150 writing interests",
      goal: "Which subjects they would enjoy exploring and writing about in WRIT-150. Ask about writing interests, not scheduling or writing ability.",
      slotIndexes: [],
      text: "What subjects would you enjoy exploring and writing about in WRIT-150?",
      options: [
        "Arts, media and culture",
        "Science, technology and environment",
        "Identity, society and social issues",
        "Business, law and public life",
        "No strong preference",
      ],
      allowFreeText: true,
    });
  }
  const slotIndexes = slots.flatMap((slot, i) => isSeminarSlot(slot) ? [i] : []);
  if (codes.some((code) => /^GESM(?:-\d{3}[A-Z]*)?$/.test(code)) || slotIndexes.length) {
    topics.push({
      id: "seminar-interests",
      kind: "course-interest",
      label: "GESM seminar interests",
      goal:
        "Which topics they would enjoy discussing in a GESM General Education Seminar. Ask about seminar subject interests, separately from WRIT-150 writing interests.",
      slotIndexes,
      text: "What topics would you enjoy exploring in your GESM General Education Seminar?",
      options: [
        "Arts, literature and media",
        "History, culture and society",
        "Science, technology and environment",
        "Identity, ethics and public life",
        "No strong preference",
      ],
      allowFreeText: true,
    });
  }
  return topics;
}

/** Labeled answers survive model omissions and quick replies as well as typed text. */
export function courseInterestNotes(topics: CourseInterestTopic[], history: InterestAnswer[]): string[] {
  return topics.flatMap((topic) => {
    const item = history.find((h) => h.questionId === topic.id);
    const text = item && [item.answer, item.freeText].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
    return text ? [`${topic.label}: ${text.slice(0, 180)}`] : [];
  });
}

export function withCourseInterestNotes(notes: string | null, interests: string[]): string | null {
  return [...interests, notes].filter(Boolean).join(" ").slice(0, 500) || null;
}

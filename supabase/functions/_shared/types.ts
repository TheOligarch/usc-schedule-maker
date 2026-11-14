// Request/response shapes from the shared build contract (section 3 and 5),
// plus the validation applied to everything the extension sends.
import { z } from "./deps.ts";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Day = (typeof DAYS)[number];
export type HHMM = string;

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM_RE, "must be 24h HH:MM");

export interface Preferences {
  daySpread: "compact" | "neutral" | "spread";
  breaks: "avoid" | "neutral" | "prefer";
  maxGapMinutes: number | null;
  preferredDaysOff: Day[];
  comfortStart: HHMM | null;
  comfortEnd: HHMM | null;
  notes: string | null;
}

export const PreferencesSchema: z.ZodType<Preferences> = z.object({
  daySpread: z.enum(["compact", "neutral", "spread"]),
  breaks: z.enum(["avoid", "neutral", "prefer"]),
  maxGapMinutes: z.number().min(0).max(24 * 60).nullable(),
  preferredDaysOff: z.array(z.enum(DAYS)).max(7),
  comfortStart: hhmm.nullable(),
  comfortEnd: hhmm.nullable(),
  notes: z.string().max(2000).nullable(),
});

// ---------- interview ----------

export const MAX_QUESTIONS = 10;
export const MAX_SHORTLIST = 5;

const courseCode = z.string().trim().min(1).max(24);

export const InterviewRequestSchema = z.object({
  termCode: z.string().trim().regex(/^[A-Za-z0-9_-]{1,16}$/, "must be a term code like 20271"),
  required: z.array(courseCode).max(30),
  slots: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["GE", "elective"]),
    geCategory: z.string().trim().min(1).max(24).optional(),
  })).max(12),
  history: z.array(z.object({
    questionId: z.string().trim().min(1).max(64),
    question: z.string().max(600),
    answer: z.string().max(400),
    freeText: z.string().max(1000).optional(),
  })).max(MAX_QUESTIONS, `the interview has at most ${MAX_QUESTIONS} questions`),
  // Optional extension to the contract: the student's overall hard window, so
  // time questions and comfort hours stay inside it.
  hardHours: z.object({ earliestStart: hhmm, latestEnd: hhmm }).optional(),
});
export type InterviewRequest = z.infer<typeof InterviewRequestSchema>;
export type Slot = InterviewRequest["slots"][number];
export type HistoryItem = InterviewRequest["history"][number];

export interface Question {
  id: string;
  text: string;
  options: string[];
  allowFreeText: true;
}

export interface Shortlist {
  label: string;
  options: { courseCode: string; reason: string }[];
}

export type InterviewResponse =
  | { done: false; question: Question }
  | { done: true; preferences: Preferences; shortlists: Shortlist[]; summary: string[] };

// ---------- explain ----------

export const MAX_EXPLAINED = 10;

const ScheduleSchema = z.object({
  id: z.string().min(1).max(128),
  units: z.number(),
  score: z.number(),
  courses: z.array(z.object({
    courseCode: courseCode,
    sectionIds: z.array(z.string().max(24)).max(12),
  })).max(20),
  penalties: z.array(z.object({
    kind: z.string().max(40),
    sectionId: z.string().max(24).optional(),
    amount: z.number(),
    message: z.string().max(400),
  })).max(60),
  warnings: z.array(z.string().max(400)).max(40),
  display: z.string().max(4000),
});
export type ExplainSchedule = z.infer<typeof ScheduleSchema>;

export const ExplainRequestSchema = z.object({
  preferences: PreferencesSchema,
  schedules: z.array(ScheduleSchema).max(MAX_EXPLAINED, `send at most the top ${MAX_EXPLAINED} schedules`),
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export interface ExplainResponse {
  explanations: { id: string; text: string }[];
}

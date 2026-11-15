/** App state: one serialisable object, persisted to localStorage between visits. */
import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT } from "./lib/config";
import type { Block, Day, Importance, InterviewHistoryItem, Preferences, ScheduleRequest, Shortlist } from "./lib/contract-types";
import { DAYS, normalizeBlocks } from "./lib/time";

export type StepId = "requirements" | "priorities" | "interview" | "results";
export const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: "requirements", label: "Requirements", hint: "Courses and times" },
  { id: "priorities", label: "Priorities", hint: "What matters to you" },
  { id: "interview", label: "Interview", hint: "A few quick questions" },
  { id: "results", label: "Schedules", hint: "Ranked for you" },
];

export interface SlotDef {
  id: string;
  label: string;
  kind: "GE" | "elective";
  geCategory?: string;
}

export interface InterviewResult {
  preferences: Preferences;
  shortlists: Shortlist[];
  summary: string[];
}

export interface TimesState {
  /** Default blocks applied to every day that has no override. */
  global: Block[];
  /** Per-day overrides; an empty array means the day is off. */
  overrides: Partial<Record<Day, Block[]>>;
  weekends: boolean;
}

export interface AppState {
  version: 2;
  step: StepId;
  termCode: string | null;
  importance: Importance;
  required: string[];
  slots: SlotDef[];
  unitCap: number | null;
  times: TimesState;
  history: InterviewHistoryItem[];
  /** Question ID of the last answered topic whose slider-only importance step is still open. */
  importanceFollowup: string | null;
  interview: InterviewResult | null;
  /** Courses/slots the interview was run for; used to notice when it has gone stale. */
  interviewFor: string | null;
  limit: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  daySpread: "neutral",
  breaks: "neutral",
  maxGapMinutes: null,
  preferredDaysOff: [],
  comfortStart: null,
  comfortEnd: null,
  notes: null,
};

export function defaultState(): AppState {
  return {
    version: 2,
    step: "requirements",
    termCode: null,
    importance: { rmp: 5, daySpread: 5, breaks: 5, seatRisk: 5, finals: 5 },
    required: [],
    slots: [],
    unitCap: 18,
    times: { global: [{ start: "08:00", end: "20:00" }], overrides: {}, weekends: false },
    history: [],
    importanceFollowup: null,
    interview: null,
    interviewFor: null,
    limit: DEFAULT_RESULT_LIMIT,
  };
}

const STORAGE_KEY = "usm:state:v2";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    // Drop the old hard rating minimum while retaining the student's ranking weights.
    const { minRmp: _legacyMinimum, ...parsed } = JSON.parse(raw) as Partial<AppState> & { minRmp?: unknown };
    if (parsed.version !== 2) return defaultState();
    const base = defaultState();
    return { ...base, ...parsed, times: { ...base.times, ...parsed.times }, importance: { ...base.importance, ...parsed.importance }, limit: Math.min(MAX_RESULT_LIMIT, Math.max(1, parsed.limit ?? base.limit)) };
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable (private mode / blocked): the app still works for this visit
  }
}

export function isWeekend(day: Day): boolean {
  return day === "Sat" || day === "Sun";
}

/** The hard allowed-time blocks that apply on one day. */
export function blocksFor(times: TimesState, day: Day): Block[] {
  const override = times.overrides[day];
  if (override) return override;
  if (isWeekend(day) && !times.weekends) return [];
  return times.global;
}

export function allowedTimes(times: TimesState): Record<Day, Block[]> {
  const out = {} as Record<Day, Block[]>;
  for (const day of DAYS) out[day] = normalizeBlocks(blocksFor(times, day));
  return out;
}

export function interviewSignature(state: Pick<AppState, "required" | "slots" | "termCode">): string {
  return JSON.stringify([state.termCode, [...state.required].sort(), state.slots.map((s) => [s.label, s.kind, s.geCategory ?? ""])]);
}

/** Shortlist rows aligned to the current slots (missing ones come back empty). */
export function alignedShortlists(slots: SlotDef[], interview: InterviewResult | null): Shortlist[] {
  return slots.map((slot) => interview?.shortlists.find((s) => s.label === slot.label) ?? { label: slot.label, options: [] });
}

export function buildRequest(state: AppState): ScheduleRequest {
  return {
    required: state.required,
    flexSlots: alignedShortlists(state.slots, state.interview).map((s) => ({ label: s.label, options: s.options.map((o) => o.courseCode) })),
    allowedTimes: allowedTimes(state.times),
    unitCap: state.unitCap,
    importance: state.importance,
    preferences: state.interview?.preferences ?? DEFAULT_PREFERENCES,
  };
}

let slotCounter = 0;
export function newSlotId(): string {
  slotCounter += 1;
  return `slot-${Date.now().toString(36)}-${slotCounter}`;
}

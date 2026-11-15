/** App state: one serialisable object, persisted to localStorage between visits. */
import { electiveInterestScore, selectedCategories } from "./lib/electiveInterests";
import { compileRefinements, migrateRefinements, type Refinement } from "./lib/refinement";
import { canonicalCourseCode, normalizePins } from "./lib/sectionPins";
import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT } from "./lib/config";
import type { Block, Day, Importance, InterviewHistoryItem, Preferences, ScheduleRequest, Shortlist } from "./lib/contract-types";
import { geShort } from "./lib/schedule";
import { DAYS, normalizeBlocks } from "./lib/time";

export type StepId = "requirements" | "priorities" | "interview" | "results";
export const STEPS: { id: StepId; label: string }[] = [
  { id: "requirements", label: "Requirements" },
  { id: "priorities", label: "Priorities" },
  { id: "interview", label: "Interview" },
  { id: "results", label: "Schedules" },
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
  /** Pinned section ids per required course: a lecture, linked components, or both. */
  sectionPins: Record<string, string[]>;
  refinements: Refinement[];
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
    sectionPins: {},
    refinements: [],
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
    return friendlySlotLabels({ ...base, ...parsed, sectionPins: normalizePins(parsed.sectionPins), refinements: migrateRefinements(parsed.refinements), times: { ...base.times, ...parsed.times }, importance: { ...base.importance, ...parsed.importance }, limit: Math.min(MAX_RESULT_LIMIT, Math.max(1, parsed.limit ?? base.limit)) });
  } catch {
    return defaultState();
  }
}

/**
 * Builds before friendly GE labels saved GE slot labels with the raw catalog prefix
 * ("ARTS course", "ARTS course 2"), and every screen shows the label as is. Rename those
 * to the GE letter ("GE-A course") along with their shortlists; geCategory stays as stored.
 */
export function friendlySlotLabels(state: AppState): AppState {
  const legacy = (slot: SlotDef): string | null => {
    if (slot.kind !== "GE" || !slot.geCategory) return null;
    const raw = slot.geCategory.trim();
    const short = geShort(raw);
    const m = /^(.*) course( \d+)?$/.exec(slot.label);
    return short !== raw && m?.[1] === raw ? short : null;
  };
  if (!Array.isArray(state.slots) || !state.slots.some((s) => legacy(s))) return state;
  const used = new Set(state.slots.filter((s) => !legacy(s)).map((s) => s.label));
  const renames = new Map<string, string>();
  const slots = state.slots.map((slot) => {
    const short = legacy(slot);
    if (!short) return slot;
    const base = `${short} course`;
    let label = slot.label.replace(/^.* course/, base);
    for (let n = 2; used.has(label); n++) label = `${base} ${n}`;
    used.add(label);
    renames.set(slot.label, label);
    return { ...slot, label };
  });
  const interview = state.interview && {
    ...state.interview,
    shortlists: state.interview.shortlists.map((s) => (renames.has(s.label) ? { ...s, label: renames.get(s.label)! } : s)),
  };
  const next = { ...state, slots, interview };
  return { ...next, interviewFor: state.interviewFor === interviewSignature(state) ? interviewSignature(next) : state.interviewFor };
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

export function interviewSignature(state: Pick<AppState, "required" | "slots" | "termCode" | "sectionPins">): string {
  const pins = Object.entries(state.sectionPins ?? {}).map(([code, ids]) => [code, [...ids].sort()] as const).filter(([, ids]) => ids.length).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([state.termCode, [...state.required].sort(), state.slots.map((s) => [s.label, s.kind, s.geCategory ?? ""]), pins]);
}

/** Shortlist rows aligned to the current slots (missing ones come back empty). */
export function alignedShortlists(slots: SlotDef[], interview: InterviewResult | null): Shortlist[] {
  return slots.map((slot) => interview?.shortlists.find((s) => s.label === slot.label) ?? { label: slot.label, options: [] });
}

/**
 * Saved or typed course codes in another format ("csci 201", a cross-listed alias) are
 * rewritten to the term's own code, so the section picker and engine see the same course.
 * Returns null when nothing changes.
 */
export function reconcileCourseCodes(state: AppState, data: import("./lib/contract-types").TermData): Partial<AppState> | null {
  let changed = false;
  const required: string[] = [];
  const rename = new Map<string, string>();
  for (const code of state.required) {
    const canon = canonicalCourseCode(data, code) ?? code;
    if (canon !== code) { changed = true; rename.set(code, canon); }
    if (!required.includes(canon)) required.push(canon);
    else changed = true;
  }
  const sectionPins: Record<string, string[]> = {};
  for (const [code, ids] of Object.entries(state.sectionPins)) {
    const canon = rename.get(code) ?? canonicalCourseCode(data, code) ?? code;
    if (canon !== code) changed = true;
    sectionPins[canon] = [...new Set([...(sectionPins[canon] ?? []), ...ids])];
  }
  return changed ? { required, sectionPins } : null;
}

export function buildRequest(state: AppState, data?: import("./lib/contract-types").TermData): ScheduleRequest {
  const courseInterestScores: Record<string, number> = {};
  if (data) for (const [i, slot] of state.slots.entries()) {
    const labels = selectedCategories(state, i);
    if (slot.kind !== "elective" || !labels.length) continue;
    for (const option of alignedShortlists(state.slots, state.interview)[i].options) {
      const c = data.courses[option.courseCode];
      if (c) courseInterestScores[c.code] = electiveInterestScore(c, labels);
    }
  }
  const flexSlots = alignedShortlists(state.slots, state.interview).map((s) => ({ label: s.label, options: s.options.map((o) => o.courseCode) }));
  const compiled = compileRefinements(state.refinements, data, [...state.required, ...flexSlots.flatMap((f) => f.options)]);
  const sectionPins = Object.fromEntries(Object.entries(state.sectionPins).filter(([, ids]) => ids.length));
  return {
    required: state.required,
    sectionPins,
    courseInterestScores,
    excludedSectionIds: compiled.excludedSectionIds,
    ...(Object.keys(compiled.sectionCosts).length ? { sectionCosts: compiled.sectionCosts } : {}),
    ...(compiled.scheduleRules.length ? { scheduleRules: compiled.scheduleRules } : {}),
    flexSlots,
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

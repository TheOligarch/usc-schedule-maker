import type { Importance } from "./types";

/**
 * Every tunable scoring number lives in this one table.
 *
 * Each penalty's final amount is `weight * importanceFactor`, where
 * importanceFactor = importance[key] / 5 (so 5 = 1x, 10 = 2x, 1 = 0.2x) and
 * `key` is the importance knob listed in IMPORTANCE_KEY below. Terms with no
 * matching importance knob are applied at 1x.
 *
 * A schedule's total penalty is the sum of all amounts; its score is
 * 100 * scoreScale / (scoreScale + total), so a schedule with no penalties
 * scores 100 and every penalty lowers it smoothly.
 *
 * Policy (captain): heavy = full, waitlist, D-clearance, online/TBA (incl.
 * HSC), final-exam conflict, ambiguous link guess; small = no RMP rating.
 */
export interface Weights {
  // --- heavy, per section/course -----------------------------------------
  /** a chosen section has no open seats */
  full: number;
  /** a chosen section is over-enrolled / has a waitlist */
  waitlist: number;
  /** a chosen section needs departmental clearance */
  dClearance: number;
  /** a course is online or has TBA meeting times */
  onlineOrTba: number;
  /** a course meets off the main campus (e.g. HSC); only when campus data exists */
  offCampus: number;
  /** two courses' final exams overlap (per pair) */
  finalConflict: number;
  /** lecture/discussion pairing was guessed from section order */
  ambiguousLink: number;

  // --- small -----------------------------------------------------------------
  /** lecture instructor missing, unmatched on RMP, or has too few ratings */
  noRmp: number;
  /** per RMP point below 5.0 for a rated lecture instructor (tie-breaker) */
  rmpQualityPerPoint: number;
  /** ratings needed before an RMP average counts (fewer = treated as unrated) */
  rmpMinRatings: number;

  // --- preference fit --------------------------------------------------------
  /** daySpread "compact": per class day beyond two */
  compactPerExtraDay: number;
  /** daySpread "spread": per available weekday left without class */
  spreadPerMissingDay: number;
  /** breaks "avoid": per hour of idle time between classes in a day */
  gapPerHour: number;
  /** breaks "prefer": per back-to-back pair of classes */
  backToBack: number;
  /** maxGapMinutes: flat penalty per gap longer than the max */
  overMaxGap: number;
  /** maxGapMinutes: extra per hour beyond the max */
  overMaxGapPerHour: number;
  /** gaps up to this many minutes are passing time, not a break */
  passingMinutes: number;
  /** per preferred day off that still has class */
  preferredDayOff: number;
  /** per hour a class meets before comfortStart / after comfortEnd (per meeting) */
  comfortPerHour: number;

  // --- scoring ---------------------------------------------------------------
  /** total penalty at which score = 50 */
  scoreScale: number;
}

export const DEFAULT_WEIGHTS: Readonly<Weights> = Object.freeze({
  full: 40,
  waitlist: 45,
  dClearance: 35,
  onlineOrTba: 40,
  offCampus: 35,
  finalConflict: 45,
  ambiguousLink: 30,

  noRmp: 6,
  rmpQualityPerPoint: 2,
  rmpMinRatings: 3,

  compactPerExtraDay: 6,
  spreadPerMissingDay: 6,
  gapPerHour: 4,
  backToBack: 3,
  overMaxGap: 6,
  overMaxGapPerHour: 4,
  passingMinutes: 15,
  preferredDayOff: 12,
  comfortPerHour: 5,

  scoreScale: 100,
});

/** Which importance knob scales each weight (null = fixed, 1x). */
export const IMPORTANCE_KEY: Readonly<Record<keyof Weights, keyof Importance | null>> = Object.freeze({
  full: "seatRisk",
  waitlist: "seatRisk",
  dClearance: "seatRisk",
  onlineOrTba: null,
  offCampus: null,
  finalConflict: "finals",
  ambiguousLink: null,
  noRmp: "rmp",
  rmpQualityPerPoint: "rmp",
  rmpMinRatings: null,
  compactPerExtraDay: "daySpread",
  spreadPerMissingDay: "daySpread",
  gapPerHour: "breaks",
  backToBack: "breaks",
  overMaxGap: "breaks",
  overMaxGapPerHour: "breaks",
  passingMinutes: null,
  preferredDayOff: "daySpread",
  comfortPerHour: null,
  scoreScale: null,
});

export function importanceFactor(value: number | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 5;
  return Math.min(10, Math.max(1, v)) / 5;
}

/** Weights with importance already applied, ready for scoring. */
export type ScaledWeights = Readonly<Weights>;

export function scaleWeights(base: Readonly<Weights>, importance: Partial<Importance> | undefined): ScaledWeights {
  const out = { ...base };
  for (const k of Object.keys(IMPORTANCE_KEY) as (keyof Weights)[]) {
    const key = IMPORTANCE_KEY[k];
    if (key) out[k] = base[k] * importanceFactor(importance?.[key]);
  }
  return out;
}

// Which terms to scrape: every active term that has not started yet.
//
// classes.usc.edu/api/Terms/Active lists the terms but carries no class dates. The start date
// comes from the registrar's finals page ("Standard session 001 dates: January 11, 2027 – ...")
// when it lists the term; otherwise we fall back to a conservative estimate per season. A term
// counts as started on its start date, after which it is no longer refreshed (its last published
// file stays available).

import type { RawTerm } from "./usc.ts";

/** Seasons by term digit: 1 = Spring, 2 = Summer, 3 = Fall. Month is 0-based. */
const FALLBACK_START: Record<number, { month: number; day: number }> = {
  1: { month: 0, day: 8 }, // Spring: second week of January
  2: { month: 4, day: 12 }, // Summer: mid-May
  3: { month: 7, day: 18 }, // Fall: mid/late August
};

export interface PlannedTerm {
  code: string;
  name: string; // "Spring 2027"
  season: string;
  year: number;
  start: string; // ISO date
  startSource: "registrar" | "estimate";
}

export function termName(t: Pick<RawTerm, "season" | "year">): string {
  return `${t.season} ${t.year}`;
}

export function estimatedStart(code: string): string {
  const year = Number(code.slice(0, 4));
  const fb = FALLBACK_START[Number(code.slice(4))] ?? { month: 0, day: 1 };
  return `${year}-${String(fb.month + 1).padStart(2, "0")}-${String(fb.day).padStart(2, "0")}`;
}

/**
 * @param knownStarts term name -> ISO start date (from the finals page)
 * @param today ISO date (UTC)
 */
export function planTerms(active: RawTerm[], knownStarts: Map<string, string>, today: string): { plan: PlannedTerm[]; skipped: PlannedTerm[] } {
  const all = active
    .filter((t) => /^\d{5}$/.test(String(t.termCode)))
    .map((t): PlannedTerm => {
      const code = String(t.termCode);
      const name = termName(t);
      const known = knownStarts.get(name);
      return { code, name, season: t.season, year: t.year, start: known ?? estimatedStart(code), startSource: known ? "registrar" : "estimate" };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  return { plan: all.filter((t) => today < t.start), skipped: all.filter((t) => today >= t.start) };
}

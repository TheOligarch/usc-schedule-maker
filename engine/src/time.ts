import type { Day } from "./types";

export const DAYS: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function dayIndex(d: string): number {
  const i = DAY_INDEX[d];
  return i === undefined ? -1 : i;
}

/** "HH:MM" -> minutes after midnight, or NaN when malformed. */
export function toMinutes(t: string | null | undefined): number {
  if (typeof t !== "string") return NaN;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return NaN;
  return h * 60 + min;
}

/** minutes -> "HH:MM" */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "Mon/Wed" style list in week order. */
export function fmtDays(days: Iterable<number>): string {
  return [...new Set(days)].sort((a, b) => a - b).map((d) => DAYS[d]).join("/");
}

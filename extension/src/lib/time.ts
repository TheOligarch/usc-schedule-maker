import type { Block, Day, HHMM, Meeting } from "./contract-types";

export const DAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const DAY_LONG: Record<Day, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};
const DAY_LETTER: Record<Day, string> = { Mon: "M", Tue: "Tu", Wed: "W", Thu: "Th", Fri: "F", Sat: "Sa", Sun: "Su" };

export function toMin(t: HHMM): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

export function toHHMM(min: number): HHMM {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "13:30" -> "1:30 PM"; `compact` drops ":00" and the space ("1:30pm", "9am"). */
export function fmtTime(t: HHMM | number, compact = false): string {
  const min = typeof t === "number" ? t : toMin(t);
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (compact) return `${h12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`}${suffix.toLowerCase()}`;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function fmtRange(start: HHMM, end: HHMM, compact = false): string {
  return `${fmtTime(start, compact)}${compact ? "-" : " - "}${fmtTime(end, compact)}`;
}

export function fmtDays(days: Day[]): string {
  return DAYS.filter((d) => days.includes(d))
    .map((d) => DAY_LETTER[d])
    .join("");
}

export function fmtMeeting(m: Meeting, compact = false): string {
  return `${fmtDays(m.days)} ${fmtRange(m.start, m.end, compact)}`;
}

/** Sort blocks and merge any that touch or overlap; drops empty/inverted blocks. */
export function normalizeBlocks(blocks: Block[]): Block[] {
  const sorted = blocks
    .map((b) => ({ s: toMin(b.start), e: toMin(b.end) }))
    .filter((b) => b.e > b.s)
    .sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e);
    else out.push({ ...b });
  }
  return out.map((b) => ({ start: toHHMM(b.s), end: toHHMM(b.e) }));
}

export function blocksEqual(a: Block[], b: Block[]): boolean {
  return a.length === b.length && a.every((x, i) => x.start === b[i].start && x.end === b[i].end);
}

/** True when [start,end] sits fully inside one of the blocks. */
export function insideBlocks(start: HHMM, end: HHMM, blocks: Block[]): boolean {
  const s = toMin(start);
  const e = toMin(end);
  return blocks.some((b) => toMin(b.start) <= s && e <= toMin(b.end));
}

export function fmtBlocks(blocks: Block[]): string {
  if (blocks.length === 0) return "Day off";
  return blocks.map((b) => fmtRange(b.start, b.end, true)).join(", ");
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago"; null when the timestamp is missing or unreadable. */
export function relativeTime(iso: string | number | null | undefined, now = Date.now()): string | null {
  const then = typeof iso === "number" ? iso : typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(then)) return null;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now"; // includes a slightly-ahead clock
  if (mins < 60) return plural(mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/**
 * The one data-freshness line shown everywhere: when the seat/course data in use was
 * last updated. Sample data and a missing timestamp get truthful wording instead.
 */
export function freshnessLine(updatedAt: string | number | null | undefined, opts: { sample?: boolean; now?: number } = {}): string {
  if (opts.sample) return "Sample seat counts, not from classes.usc.edu";
  const rel = relativeTime(updatedAt, opts.now);
  return rel ? `Live seat counts from classes.usc.edu, updated ${rel}` : "Live seat counts from classes.usc.edu; last update time unavailable";
}

/** Remove [start,end) from every block, splitting blocks that straddle it. */
export function subtractBlocks(blocks: Block[], start: HHMM, end: HHMM): Block[] {
  const s = toMin(start);
  const e = toMin(end);
  const out: Block[] = [];
  for (const b of normalizeBlocks(blocks)) {
    const bs = toMin(b.start);
    const be = toMin(b.end);
    if (be <= s || bs >= e) {
      out.push(b);
      continue;
    }
    if (bs < s) out.push({ start: b.start, end: toHHMM(s) });
    if (be > e) out.push({ start: toHHMM(e), end: b.end });
  }
  return out;
}

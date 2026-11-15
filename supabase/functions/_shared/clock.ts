// Student-facing clock times are always 12-hour ("8:00 PM"), matching the
// extension's fmtTime. Internal values stay "HH:MM" 24-hour; only text changes.
// Dependency-free so the extension can import it from source too.

/** Minutes after midnight (0-1440) -> "8:00 PM"; 0 and 1440 are "12:00 AM". */
export function fmtClock(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

// "H:MM"/"HH:MM" not already followed by am/pm and not part of a longer number.
const CLOCK = /(?<![\d:.])([01]?\d|2[0-4]):([0-5]\d)(?![\d:])(?!\s*[ap]\.?m\b)/gi;

/**
 * Rewrites 24-hour clock times in free text ("after 20:00", "09:30") as 12-hour times.
 * A bare single-digit hour such as "8:00" is left alone: it is not 24-hour notation and
 * may be a 12-hour time missing its suffix, so guessing AM could be wrong.
 */
export function normalizeClockTimes(text: string): string {
  return text.replace(CLOCK, (match, hh: string, mm: string) => {
    const h = Number(hh);
    if (h === 24 && mm !== "00") return match;
    if (hh.length === 1 && h !== 0) return match;
    return fmtClock(h * 60 + Number(mm));
  });
}

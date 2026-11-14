/**
 * Live seat counts for the courses of the schedule being viewed. The request is made by
 * the extension's background service worker (classes.usc.edu sends no CORS headers), so
 * it only works when the app runs inside the installed extension.
 */
import type { Section } from "./contract-types";

export interface LiveSeat {
  registered: number;
  total: number;
  isFull: boolean;
  dClearance: boolean;
  cancelled: boolean;
}

export interface SeatsRequest {
  type: "usm:seats";
  termCode: string;
  courseCodes: string[];
}

export interface SeatsResponse {
  ok: boolean;
  seats: Record<string, LiveSeat>; // key = sisSectionId
  failed: string[]; // course codes that could not be fetched
  fetchedAt: string;
  error?: string;
}

/** Shape of the parts of the classes.usc.edu course response that we read. */
interface ApiSection {
  sisSectionId?: string | number;
  totalSeats?: number | null;
  registeredSeats?: number | null;
  isFull?: boolean | null;
  hasDClearance?: boolean | null;
  isCancelled?: boolean | null;
}

export function parseCourseSeats(body: unknown): Record<string, LiveSeat> {
  const out: Record<string, LiveSeat> = {};
  const sections = (body as { sections?: ApiSection[] } | null)?.sections;
  if (!Array.isArray(sections)) return out;
  for (const sec of sections) {
    if (sec.sisSectionId === undefined || sec.sisSectionId === null) continue;
    const total = Number(sec.totalSeats ?? 0);
    const registered = Number(sec.registeredSeats ?? 0);
    out[String(sec.sisSectionId)] = {
      registered,
      total,
      isFull: Boolean(sec.isFull) || (total > 0 && registered >= total),
      dClearance: Boolean(sec.hasDClearance),
      cancelled: Boolean(sec.isCancelled),
    };
  }
  return out;
}

export function liveSeatsAvailable(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) && typeof chrome.runtime.sendMessage === "function";
}

export async function fetchLiveSeats(termCode: string, courseCodes: string[]): Promise<SeatsResponse> {
  const empty = { seats: {}, failed: courseCodes, fetchedAt: new Date().toISOString() };
  if (!liveSeatsAvailable()) return { ok: false, ...empty, error: "Live seat counts need the installed extension." };
  try {
    const message: SeatsRequest = { type: "usm:seats", termCode, courseCodes: [...new Set(courseCodes)] };
    const res = (await chrome.runtime.sendMessage(message)) as SeatsResponse | undefined;
    if (!res) return { ok: false, ...empty, error: "The extension background worker did not answer." };
    return res;
  } catch (err) {
    return { ok: false, ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Section with live seat numbers applied when we have them. */
export function withLiveSeats(section: Section, live: Record<string, LiveSeat>): Section {
  const seat = live[section.id];
  if (!seat) return section;
  return { ...section, seats: { registered: seat.registered, total: seat.total }, isFull: seat.isFull, dClearance: seat.dClearance || section.dClearance };
}

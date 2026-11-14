/**
 * Background service worker.
 *  - Toolbar icon opens the app as a full tab (works without logging in to WebReg).
 *  - Answers "usm:seats" messages from the app with live seat counts, fetched here
 *    because classes.usc.edu does not send CORS headers.
 */
import { CLASSES_API } from "../lib/config";
import { parseCourseSeats, type LiveSeat, type SeatsRequest, type SeatsResponse } from "../lib/seats";

const MAX_CONCURRENT = 6;
const MAX_COURSES = 16;
const TERM_RE = /^\d{5}$/;
const COURSE_RE = /^[A-Z]{2,5}-\d{2,3}[A-Z]{0,4}$/;

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

async function fetchCourse(termCode: string, courseCode: string): Promise<Record<string, LiveSeat>> {
  const url = `${CLASSES_API}?termCode=${encodeURIComponent(termCode)}&courseCode=${encodeURIComponent(courseCode)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCourseSeats(await res.json());
}

async function fetchSeats(req: SeatsRequest): Promise<SeatsResponse> {
  const fetchedAt = new Date().toISOString();
  const codes = [...new Set(req.courseCodes.map((c) => String(c).toUpperCase()))].filter((c) => COURSE_RE.test(c)).slice(0, MAX_COURSES);
  if (!TERM_RE.test(req.termCode) || codes.length === 0) return { ok: false, seats: {}, failed: codes, fetchedAt, error: "Invalid seat request." };

  const seats: Record<string, LiveSeat> = {};
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < codes.length) {
      const code = codes[next++];
      try {
        Object.assign(seats, await fetchCourse(req.termCode, code));
      } catch {
        failed.push(code);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, codes.length) }, worker));
  return { ok: failed.length < codes.length, seats, failed, fetchedAt };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const req = message as Partial<SeatsRequest> | null;
  if (sender.id !== chrome.runtime.id || !req || req.type !== "usm:seats" || typeof req.termCode !== "string" || !Array.isArray(req.courseCodes)) return false;
  fetchSeats(req as SeatsRequest).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, seats: {}, failed: req.courseCodes ?? [], fetchedAt: new Date().toISOString(), error: String(err) } satisfies SeatsResponse),
  );
  return true; // async response
});

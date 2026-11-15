/**
 * Links from a generated schedule into WebReg, where the student actually registers.
 *
 * WebReg lists a course with all its sections at `/Courses?Program=<DEPT>&Course=<CODE>`
 * (the same page its department listing and course search lead to). The link adds, in the
 * URL fragment, the sections this schedule picked and the schedule's term. The fragment never
 * reaches WebReg's server; our content script reads it on that page and highlights those
 * sections (see content/sectionHighlight.ts). Nothing is clicked, added or registered.
 *
 * WebReg keeps the term in the signed-in session (chosen at `/Terms?term=<code>&handler=TermSelect`),
 * not in the course URL, so the link cannot switch it; the content script points out a mismatch.
 */

export const WEBREG_ORIGIN = "https://webreg.usc.edu";

/** Fragment keys, e.g. `#usm-sections=50380,50383,50386&usm-term=20271`. */
export const SECTIONS_PARAM = "usm-sections";
export const TERM_PARAM = "usm-term";

/** "CSCI-201" -> "CSCI"; WebReg's program code is the course prefix. */
export function departmentOf(courseCode: string): string {
  return courseCode.trim().toUpperCase().replace(/[\s-]*\d.*$/, "");
}

/** The WebReg page where a student registers for `courseCode`, flagged with the schedule's sections. */
export function webregRegisterUrl(courseCode: string, sectionIds: string[], termCode?: string): string {
  const code = courseCode.trim().toUpperCase().replace(/\s+/g, "-");
  const url = new URL("/Courses", WEBREG_ORIGIN);
  url.searchParams.set("Program", departmentOf(code));
  url.searchParams.set("Course", code);
  const fragment = new URLSearchParams();
  const ids = sectionIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length) fragment.set(SECTIONS_PARAM, ids.join(","));
  if (ids.length && termCode) fragment.set(TERM_PARAM, termCode);
  const hash = fragment.toString().replace(/%2C/gi, ",");
  if (hash) url.hash = hash;
  return url.toString();
}

/** Section ids carried in a location hash by `webregRegisterUrl`; [] when there are none. */
export function sectionIdsFromHash(hash: string): string[] {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get(SECTIONS_PARAM);
  if (!raw) return [];
  return Array.from(new Set(raw.split(",").map((id) => id.trim()).filter((id) => /^[0-9A-Za-z]+$/.test(id))));
}

/** The schedule's term code carried in a location hash, or null. */
export function termFromHash(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get(TERM_PARAM);
  return raw && /^\d{5}$/.test(raw) ? raw : null;
}

/** USC term codes are year + 1 (Spring), 2 (Summer) or 3 (Fall): "20271" -> "Spring 2027". */
export function termName(code: string): string {
  const season = { "1": "Spring", "2": "Summer", "3": "Fall" }[code.slice(4)];
  return season ? `${season} ${code.slice(0, 4)}` : code;
}

/** WebReg's own page for switching the session to `termCode`. */
export function webregTermSelectUrl(termCode: string): string {
  return `${WEBREG_ORIGIN}/Terms?term=${encodeURIComponent(termCode)}&handler=TermSelect`;
}

/**
 * Links from a generated schedule into WebReg, where the student actually registers.
 *
 * A Register link opens the WebReg course listing for the course's department (WebReg lists
 * a department's courses with every section on one page) and carries the sections this
 * schedule picked for that course in the URL fragment. The fragment never reaches WebReg's
 * server; our content script reads it on that page and highlights those sections
 * (see content/sectionHighlight.ts). Nothing is clicked, added or registered.
 */

export const WEBREG_ORIGIN = "https://webreg.usc.edu";

/** Fragment key holding the chosen section ids, e.g. `#usm-sections=30381,30382`. */
export const SECTIONS_PARAM = "usm-sections";

/** "CSCI-201" -> "CSCI"; WebReg's department code is the course prefix. */
export function departmentOf(courseCode: string): string {
  return courseCode.trim().toUpperCase().replace(/[\s-]*\d.*$/, "");
}

/** The WebReg page where a student registers for `courseCode`, flagged with the schedule's sections. */
export function webregRegisterUrl(courseCode: string, sectionIds: string[]): string {
  const url = new URL("/Courses", WEBREG_ORIGIN);
  url.searchParams.set("DeptId", departmentOf(courseCode));
  const ids = sectionIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length) url.hash = `${SECTIONS_PARAM}=${ids.map(encodeURIComponent).join(",")}`;
  return url.toString();
}

/** Section ids carried in a location hash by `webregRegisterUrl`; [] when there are none. */
export function sectionIdsFromHash(hash: string): string[] {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const raw = params.get(SECTIONS_PARAM);
  if (!raw) return [];
  return Array.from(new Set(raw.split(",").map((id) => id.trim()).filter((id) => /^[0-9A-Za-z]+$/.test(id))));
}

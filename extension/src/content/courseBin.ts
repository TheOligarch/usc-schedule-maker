/**
 * Content-script half of "Add this whole schedule to myCourseBin" (see lib/courseBin.ts).
 *
 * Runs on webreg.usc.edu, so its requests are same-origin and carry the student's own WebReg
 * session. For each course it loads WebReg's course page, reads the session term from
 * `#ActiveTerm`, and for each section uses the "Add to myCourseBin" form WebReg rendered for
 * that section: its data-ajax-url and its anti-forgery token. Every request goes through
 * `isAllowedBinRequest`, so the only things it can do are read a course page and add a section.
 */

import {
  ADD_PATH_RE,
  ADD_TYPE,
  COURSE_RE,
  PREPARE_TYPE,
  SECTION_RE,
  TERM_RE,
  TOKEN_FIELD,
  buildAddRequest,
  classifyAddResponse,
  coursePageUrl,
  isAllowedBinRequest,
  type AddForm,
  type BinAddRequest,
  type BinAddResponse,
  type BinPrepareRequest,
  type BinPrepareResponse,
} from "../lib/courseBin";
import { termName } from "../lib/webreg";

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const MAX_COURSES = 16;

/** Wraps `fetch` so that nothing but the allowlisted requests can leave the content script. */
export function guardedFetcher(fetcher: Fetcher): Fetcher {
  return (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (!isAllowedBinRequest(method, url)) return Promise.reject(new Error(`Blocked ${method} ${url}: only adding to myCourseBin is allowed.`));
    return fetcher(url, init);
  };
}

/** WebReg's session term from a course page's hidden `#ActiveTerm` field. */
export function pageActiveTerm(doc: ParentNode): string | null {
  const value = doc.querySelector<HTMLInputElement>("input#ActiveTerm")?.value?.trim() ?? "";
  return TERM_RE.test(value) ? value : null;
}

/**
 * WebReg's own add form for `sectionId` in `termCode`: the form whose data-ajax-url is exactly
 * `/api/section/<termCode>/<sectionId>/add`, posting, with a token. Null when the page has none.
 */
export function findAddForm(doc: ParentNode, termCode: string, sectionId: string): AddForm | null {
  for (const form of Array.from(doc.querySelectorAll<HTMLFormElement>("form[data-ajax-url]"))) {
    const path = form.getAttribute("data-ajax-url")?.trim() ?? "";
    const match = ADD_PATH_RE.exec(path);
    if (!match || match[1] !== termCode || match[2] !== sectionId) continue;
    const method = (form.getAttribute("data-ajax-method") ?? form.getAttribute("method") ?? "").toLowerCase();
    if (method !== "post") continue;
    const token = form.querySelector<HTMLInputElement>(`input[name="${TOKEN_FIELD}"]`)?.value ?? "";
    if (!token) continue;
    return { path, token };
  }
  return null;
}

type PageResult = { kind: "page"; doc: Document } | { kind: "auth"; message: string } | { kind: "error"; message: string };

const SIGN_IN_AGAIN = "WebReg's session has ended. Sign in to WebReg again, then retry.";

export interface CourseBinService {
  prepare(req: BinPrepareRequest): Promise<BinPrepareResponse>;
  add(req: BinAddRequest): Promise<BinAddResponse>;
}

export function createCourseBinService(fetcher: Fetcher, parse: (html: string) => Document = (html) => new DOMParser().parseFromString(html, "text/html")): CourseBinService {
  const request = guardedFetcher(fetcher);
  const pages = new Map<string, Document>();

  async function loadPage(courseCode: string): Promise<PageResult> {
    let res: Response;
    try {
      res = await request(coursePageUrl(courseCode), { method: "GET", credentials: "same-origin", redirect: "manual", cache: "no-store", headers: { Accept: "text/html" } });
    } catch (err) {
      return { kind: "error", message: `Could not load WebReg's ${courseCode} page: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.type === "opaqueredirect" || res.status === 0 || res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) return { kind: "auth", message: SIGN_IN_AGAIN };
    if (!res.ok) return { kind: "error", message: `WebReg's ${courseCode} page answered HTTP ${res.status}.` };
    const doc = parse(await res.text());
    // A signed-in course page always carries the session term; a sign-in page does not.
    if (!pageActiveTerm(doc)) return { kind: "auth", message: "WebReg did not show its course page (it may be asking you to sign in). Sign in to WebReg again, then retry." };
    pages.set(courseCode, doc);
    return { kind: "page", doc };
  }

  return {
    async prepare(req) {
      pages.clear();
      let activeTerm: string | null = null;
      for (const code of req.courseCodes) {
        const page = await loadPage(code);
        if (page.kind !== "page") return { ok: false, reason: page.kind, message: page.message };
        const term = pageActiveTerm(page.doc)!;
        activeTerm ??= term;
        if (term !== req.termCode) {
          return { ok: false, reason: "term-mismatch", activeTerm: term, message: `This schedule is for ${termName(req.termCode)}, but WebReg is showing ${termName(term)}. Nothing was added.` };
        }
      }
      if (!activeTerm) return { ok: false, reason: "error", message: "No courses to add." };
      return { ok: true, activeTerm };
    },

    async add(req) {
      let doc = pages.get(req.courseCode);
      if (!doc) {
        const page = await loadPage(req.courseCode);
        if (page.kind === "auth") return { outcome: "auth", message: page.message };
        if (page.kind === "error") return { outcome: "failed", message: page.message };
        doc = page.doc;
      }
      const term = pageActiveTerm(doc);
      if (term !== req.termCode) return { outcome: "term-mismatch", message: `WebReg is showing ${term ? termName(term) : "another term"}, not ${termName(req.termCode)}. Nothing more was added.` };
      const form = findAddForm(doc, req.termCode, req.sectionId);
      if (!form) return { outcome: "failed", message: `WebReg's ${req.courseCode} page has no "Add to myCourseBin" button for section ${req.sectionId}.` };
      const built = buildAddRequest(form);
      let res: Response;
      try {
        res = await request(built.url, built.init);
      } catch (err) {
        return { outcome: "failed", message: `Could not reach WebReg: ${err instanceof Error ? err.message : String(err)}` };
      }
      const body = res.type === "opaqueredirect" ? "" : await res.text().catch(() => "");
      return classifyAddResponse({ status: res.status, type: res.type, body });
    },
  };
}

function validPrepare(m: Record<string, unknown>): m is BinPrepareRequest & Record<string, unknown> {
  return (
    m.type === PREPARE_TYPE &&
    typeof m.termCode === "string" &&
    TERM_RE.test(m.termCode) &&
    Array.isArray(m.courseCodes) &&
    m.courseCodes.length > 0 &&
    m.courseCodes.length <= MAX_COURSES &&
    m.courseCodes.every((c) => typeof c === "string" && COURSE_RE.test(c))
  );
}

function validAdd(m: Record<string, unknown>): m is BinAddRequest & Record<string, unknown> {
  return m.type === ADD_TYPE && typeof m.termCode === "string" && TERM_RE.test(m.termCode) && typeof m.courseCode === "string" && COURSE_RE.test(m.courseCode) && typeof m.sectionId === "string" && SECTION_RE.test(m.sectionId);
}

/**
 * Handles a course-bin message if it is one and comes from this extension's own app page;
 * returns null for anything else so other listeners can answer it.
 */
export function handleCourseBinMessage(
  service: CourseBinService,
  message: unknown,
  sender: { id?: string; url?: string },
  extension: { id: string; appUrl: string },
): Promise<BinPrepareResponse | BinAddResponse> | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  if (m.type !== PREPARE_TYPE && m.type !== ADD_TYPE) return null;
  if (sender.id !== extension.id || !sender.url || !sender.url.startsWith(extension.appUrl)) return null;
  if (validPrepare(m)) return service.prepare({ type: PREPARE_TYPE, termCode: m.termCode, courseCodes: [...m.courseCodes] });
  if (validAdd(m)) return service.add({ type: ADD_TYPE, termCode: m.termCode, courseCode: m.courseCode, sectionId: m.sectionId });
  return Promise.resolve(m.type === PREPARE_TYPE ? { ok: false, reason: "error", message: "Invalid course-bin request." } : { outcome: "failed", message: "Invalid course-bin request." });
}

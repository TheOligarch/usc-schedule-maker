/**
 * "Add this whole schedule to myCourseBin", done with WebReg's own add control.
 *
 * On WebReg's course page (`/Courses?Program=<DEPT>&Course=<CODE>`) every section row carries
 * WebReg's own "Add to myCourseBin" form, rendered for jquery-unobtrusive-ajax:
 *
 *   <form action="/api/Section/Add" data-ajax="true" data-ajax-method="Post"
 *         data-ajax-url="/api/section/20271/29966/add" method="post">
 *     <button type="submit" name="submit" ...>Add to myCourseBin</button>
 *     <input name="__RequestVerificationToken" type="hidden" value="...">
 *   </form>
 *
 * (see __tests__/fixtures/webreg-course-*.html, captured signed in). Pressing the button makes
 * jquery-unobtrusive-ajax POST to the data-ajax-url, same-origin, with the form fields
 * urlencoded: the clicked button (`submit=`), the anti-forgery token, and its own
 * `X-Requested-With=XMLHttpRequest` marker, plus jQuery's `X-Requested-With` header. WebReg's
 * site bundle also adds `X-CSRF: 1` to every same-origin request (a jQuery ajaxPrefilter and a
 * window.fetch wrapper); without it the add is refused with HTTP 401 "Missing or invalid X-CSRF
 * header." (__tests__/fixtures/webreg-add-401-missing-csrf.json, a real response). The content
 * script's fetch runs in its own world, outside WebReg's wrapper, so it sets the header itself.
 *
 * The extension makes exactly that request from its content script on webreg.usc.edu, in the
 * student's signed-in session: it loads the course page, finds the form for the section,
 * takes the URL and token WebReg rendered into it, and posts them. Nothing is stored.
 *
 * Only adding is possible. `isAllowedBinRequest` admits a GET of a course page and a POST to
 * `/api/section/<term>/<section>/add`, nothing else; every request the content script makes
 * goes through it, so no register, drop, checkout, remove or schedule-submit request can be
 * produced even from a tampered page.
 *
 * This module is shared: the protocol and pure helpers are used by the content script
 * (content/courseBin.ts), and the runner and transport by the app.
 */

import type { RankedSchedule, TermData } from "./contract-types";
import { SECTION_TYPE_LABEL } from "./schedule";
import { WEBREG_ORIGIN, departmentOf } from "./webreg";

/** The only POST the extension may make: WebReg's add-to-course-bin action. */
export const ADD_PATH_RE = /^\/api\/section\/(\d{5})\/([0-9A-Za-z]{1,12})\/add$/;
export const TERM_RE = /^\d{5}$/;
export const COURSE_RE = /^[A-Z]{2,5}-\d{2,3}[A-Z]{0,4}$/;
export const SECTION_RE = /^[0-9A-Za-z]{1,12}$/;
export const TOKEN_FIELD = "__RequestVerificationToken";
/** WebReg's site bundle sends this header, value "1", with every same-origin request. */
export const CSRF_HEADER = "X-CSRF";

export const PREPARE_TYPE = "usm:bin-prepare";
export const ADD_TYPE = "usm:bin-add";

export interface BinPrepareRequest {
  type: typeof PREPARE_TYPE;
  termCode: string;
  courseCodes: string[];
}
export type BinPrepareResponse =
  | { ok: true; activeTerm: string }
  | { ok: false; reason: "term-mismatch"; activeTerm: string; message: string }
  | { ok: false; reason: "auth" | "error"; message: string };

export interface BinAddRequest {
  type: typeof ADD_TYPE;
  termCode: string;
  courseCode: string;
  sectionId: string;
}
/** "auth" and "term-mismatch" stop the run; the others are a result for that one section. */
export type BinAddOutcome = "added" | "already" | "failed" | "auth" | "term-mismatch";
export interface BinAddResponse {
  outcome: BinAddOutcome;
  message: string | null;
}

// ---- Request shape ---------------------------------------------------------------

/** WebReg's course page for `courseCode`, as the Register link opens it (without the fragment). */
export function coursePageUrl(courseCode: string): string {
  const url = new URL("/Courses", WEBREG_ORIGIN);
  url.searchParams.set("Program", departmentOf(courseCode));
  url.searchParams.set("Course", courseCode);
  return url.toString();
}

/**
 * The allowlist every content-script request passes through: a GET of a WebReg course page, or
 * a POST to WebReg's add-to-course-bin action. Anything else (another path, method, origin,
 * query or fragment) is refused.
 */
export function isAllowedBinRequest(method: string, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== WEBREG_ORIGIN || u.hash || u.username || u.password) return false;
  if (method === "GET") {
    const keys = [...u.searchParams.keys()];
    const program = u.searchParams.get("Program") ?? "";
    const course = u.searchParams.get("Course") ?? "";
    return u.pathname === "/Courses" && keys.length === 2 && keys.includes("Program") && keys.includes("Course") && COURSE_RE.test(course) && program === departmentOf(course);
  }
  if (method === "POST") return ADD_PATH_RE.test(u.pathname) && !u.search;
  return false;
}

export interface AddForm {
  path: string; // "/api/section/20271/29966/add", as WebReg rendered it
  token: string;
}

export interface BuiltRequest {
  url: string;
  init: RequestInit & { method: "POST"; body: string; headers: Record<string, string> };
}

/** The request WebReg's own form sends when its "Add to myCourseBin" button is pressed. */
export function buildAddRequest(form: AddForm): BuiltRequest {
  const url = WEBREG_ORIGIN + form.path;
  if (!isAllowedBinRequest("POST", url)) throw new Error(`Refusing to post to ${form.path}: not WebReg's add-to-course-bin action.`);
  const body = new URLSearchParams([
    ["submit", ""],
    [TOKEN_FIELD, form.token],
    ["X-Requested-With", "XMLHttpRequest"],
  ]).toString();
  return {
    url,
    init: {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        [CSRF_HEADER]: "1",
      },
      body,
    },
  };
}

// ---- Response ------------------------------------------------------------------

const MESSAGE_KEYS = ["message", "Message", "msg", "errorMessage", "ErrorMessage", "error", "Error", "statusMessage", "StatusMessage", "result", "Result", "text", "Text"];
const ALREADY_RE = /\balready\b/i;
const LOGIN_RE = /<title>[^<]*(log ?in|sign ?in|single sign-on)|<form[^>]*(login|signin|saml|shibboleth|sso)/i;

function cleanText(raw: string): string {
  return raw
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** WebReg's own message from a response body (JSON message field, JSON string, or text). */
export function responseMessage(body: string): string | null {
  const json = readJson(body);
  if (typeof json === "string") return cleanText(json) || null;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of MESSAGE_KEYS) if (typeof obj[key] === "string" && obj[key]) return cleanText(obj[key] as string) || null;
    return null;
  }
  return cleanText(body) || null;
}

/**
 * What WebReg's answer to an add means for that section. WebReg's own page decides the same way
 * (its `handleAddCourseBin`, read from the live site bundle): HTTP 200 is "placed in your Course
 * Bin", any other status is "Error adding", and the body is not read. A real successful add
 * answers 200 with an empty body (__tests__/fixtures/webreg-add-200-success.json), and so does a
 * repeat add of a section already in the bin (webreg-add-200-repeat.json), so "already in bin"
 * cannot come from this answer; the content script reads it from the course page before posting
 * (content/courseBin.ts `isAlreadyInBin`). On top of that, a message
 * saying "already" is reported as already in the bin, and a redirect, 401/403 or the sign-in page
 * stops the run, since every later add would be refused the same way.
 */
export function classifyAddResponse(res: { status: number; type?: string; body: string }): BinAddResponse {
  if (res.type === "opaqueredirect" || res.status === 0 || (res.status >= 300 && res.status < 400)) {
    return { outcome: "auth", message: "WebReg redirected the request; its session may have ended. Sign in to WebReg again, then retry." };
  }
  const message = responseMessage(res.body);
  if (res.status === 401 || res.status === 403) {
    return { outcome: "auth", message: message ? `WebReg refused the request (HTTP ${res.status}): ${message}` : `WebReg refused the request (HTTP ${res.status}). Sign in to WebReg again, then retry.` };
  }
  if (LOGIN_RE.test(res.body)) return { outcome: "auth", message: "WebReg answered with its sign-in page. Sign in to WebReg again, then retry." };
  if (message && ALREADY_RE.test(message)) return { outcome: "already", message };
  if (res.status === 200) return { outcome: "added", message };
  return { outcome: "failed", message: message ?? `WebReg answered HTTP ${res.status}.` };
}

// ---- App side: the run -----------------------------------------------------------

export interface BinItem {
  courseCode: string;
  sectionId: string;
  typeLabel: string;
}

export type BinStatus = "pending" | "adding" | "added" | "already" | "failed" | "skipped";
export interface BinItemResult extends BinItem {
  status: BinStatus;
  message: string | null;
}

/** Every section of a schedule (lecture, lab, discussion, quiz...), course by course. */
export function binItems(data: TermData, schedule: RankedSchedule): BinItem[] {
  const seen = new Set<string>();
  const items: BinItem[] = [];
  for (const course of schedule.courses) {
    for (const id of course.sectionIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const type = data.sections[id]?.type;
      items.push({ courseCode: course.courseCode.trim().toUpperCase().replace(/\s+/g, "-"), sectionId: id, typeLabel: type ? SECTION_TYPE_LABEL[type] : "Section" });
    }
  }
  return items;
}

export interface BinTransport {
  prepare(req: BinPrepareRequest): Promise<BinPrepareResponse>;
  add(req: BinAddRequest): Promise<BinAddResponse>;
}

export type BinRunEnd = { kind: "done" } | { kind: "stopped"; reason: "auth" | "term-mismatch" | "error"; message: string; activeTerm?: string };

/** Checks WebReg's session term against the schedule's before anything is added. */
export async function prepareBin(transport: BinTransport, termCode: string, items: BinItem[]): Promise<BinPrepareResponse> {
  const courseCodes = [...new Set(items.map((i) => i.courseCode))];
  try {
    return await transport.prepare({ type: PREPARE_TYPE, termCode, courseCodes });
  } catch (err) {
    return { ok: false, reason: "error", message: `Could not reach WebReg: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Adds the sections one at a time, reporting every change through `onUpdate`. A session
 * problem or a term change stops the run; sections not tried by then are left "skipped".
 */
export async function runBinAdd(transport: BinTransport, termCode: string, items: BinItem[], onUpdate: (results: BinItemResult[]) => void): Promise<BinRunEnd> {
  const results: BinItemResult[] = items.map((item) => ({ ...item, status: "pending", message: null }));
  const publish = () => onUpdate(results.map((r) => ({ ...r })));
  publish();
  for (let i = 0; i < results.length; i++) {
    results[i].status = "adding";
    publish();
    let res: BinAddResponse;
    try {
      res = await transport.add({ type: ADD_TYPE, termCode, courseCode: results[i].courseCode, sectionId: results[i].sectionId });
    } catch (err) {
      res = { outcome: "failed", message: `Could not reach WebReg: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.outcome === "auth" || res.outcome === "term-mismatch") {
      results[i].status = "failed";
      results[i].message = res.message;
      for (let j = i + 1; j < results.length; j++) results[j].status = "skipped";
      publish();
      return { kind: "stopped", reason: res.outcome, message: res.message ?? "WebReg stopped accepting requests." };
    }
    results[i].status = res.outcome;
    results[i].message = res.message;
    publish();
  }
  return { kind: "done" };
}

// ---- App side: the transport to the content script ------------------------------

/** True when the app runs inside the WebReg tab, where the content script can add for it. */
export function courseBinAvailable(): boolean {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id) &&
    typeof chrome.tabs?.getCurrent === "function" &&
    typeof chrome.tabs?.sendMessage === "function" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("embedded")
  );
}

/** Sends to the content script of the WebReg tab hosting this app's frame (top frame only). */
export function chromeBinTransport(): BinTransport {
  const send = async <T>(message: BinPrepareRequest | BinAddRequest): Promise<T> => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) throw new Error("Schedule Maker is not open inside a WebReg tab.");
    const reply = (await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 })) as T | undefined;
    if (!reply) throw new Error("WebReg's page did not answer; reload WebReg and try again.");
    return reply;
  };
  return {
    prepare: (req) => send<BinPrepareResponse>(req),
    add: (req) => send<BinAddResponse>(req),
  };
}

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import csci103Html from "./fixtures/webreg-course-CSCI-103.html?raw";
import phys151Html from "./fixtures/webreg-course-PHYS-151.html?raw";
import { CourseBinDialog } from "../components/CourseBinDialog";
import { createCourseBinService, findAddForm, guardedFetcher, handleCourseBinMessage, pageActiveTerm, type Fetcher } from "../content/courseBin";
import {
  ADD_TYPE,
  PREPARE_TYPE,
  binItems,
  buildAddRequest,
  classifyAddResponse,
  coursePageUrl,
  isAllowedBinRequest,
  runBinAdd,
  type BinAddResponse,
  type BinItemResult,
  type BinTransport,
} from "../lib/courseBin";
import type { RankedSchedule, Section, SectionType, TermData } from "../lib/contract-types";
import { webregTermSelectUrl } from "../lib/webreg";

// A schedule built from the real WebReg pages (Spring 2027): every component of both courses.
const SCHEDULE: RankedSchedule = {
  id: "s1",
  units: 8,
  score: 9,
  courses: [
    { courseCode: "CSCI-103", sectionIds: ["29966", "29903", "29900"] },
    { courseCode: "PHYS-151", sectionIds: ["50381", "50383", "50390"] },
  ],
  penalties: [],
  warnings: [],
};
const TYPES: Record<string, SectionType> = { "29966": "LEC", "29903": "LAB", "29900": "QZ", "50381": "LEC", "50383": "DIS", "50390": "LAB" };
const DATA = {
  term: { code: "20271", name: "Spring 2027", scrapedAt: "2026-11-15T00:00:00Z" },
  courses: {},
  sections: Object.fromEntries(Object.entries(TYPES).map(([id, type]) => [id, { id, type } as Section])),
  rmp: {},
} as unknown as TermData;
const ALL_IDS = SCHEDULE.courses.flatMap((c) => c.sectionIds);

const PAGES: Record<string, string> = { "CSCI-103": csci103Html, "PHYS-151": phys151Html };

interface Seen {
  method: string;
  url: string;
  init: RequestInit;
}

/**
 * A stand-in for webreg.usc.edu: serves the saved course pages (each with its own token in
 * place of the scrubbed one) and answers add requests from `answers` (default: added).
 */
function fakeWebReg(options: { activeTerm?: string; answers?: Record<string, () => Response>; page?: (code: string) => Response | null } = {}) {
  const seen: Seen[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    seen.push({ method, url, init });
    const u = new URL(url);
    if (method === "GET" && u.pathname === "/Courses") {
      const code = u.searchParams.get("Course")!;
      const custom = options.page?.(code);
      if (custom) return custom;
      let html = PAGES[code].replaceAll('value="SCRUBBED"', `value="token-${code}"`);
      if (options.activeTerm) html = html.replace('id="ActiveTerm" value="20271"', `id="ActiveTerm" value="${options.activeTerm}"`);
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    const id = /\/api\/section\/\d{5}\/(\w+)\/add$/.exec(u.pathname)?.[1];
    if (method === "POST" && id) return options.answers?.[id]?.() ?? new Response(JSON.stringify({ success: true, message: "Section added to myCourseBin." }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { fetcher, seen, posts: () => seen.filter((s) => s.method === "POST") };
}

const opaqueRedirect = () => ({ type: "opaqueredirect", status: 0, ok: false, text: async () => "" }) as unknown as Response;

/** Every request the extension made must be a course-page read or an add, nothing else. */
function expectOnlyReadsAndAdds(seen: Seen[]) {
  for (const s of seen) {
    expect(isAllowedBinRequest(s.method, s.url)).toBe(true);
    const path = new URL(s.url).pathname;
    expect(path === "/Courses" || /^\/api\/section\/\d{5}\/\w+\/add$/.test(path)).toBe(true);
    expect(path).not.toMatch(/drop|remove|delete|register|checkout|submit|schedule|cart|enroll/i);
  }
}

describe("WebReg's add form, as the saved pages render it", () => {
  const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

  it("finds the section's own form: its add URL and its anti-forgery token", () => {
    const page = doc(csci103Html);
    expect(pageActiveTerm(page)).toBe("20271");
    expect(findAddForm(page, "20271", "29966")).toEqual({ path: "/api/section/20271/29966/add", token: "SCRUBBED" });
    expect(findAddForm(doc(phys151Html), "20271", "50390")).toEqual({ path: "/api/section/20271/50390/add", token: "SCRUBBED" });
  });

  it("finds nothing for another term, an unlisted section, or a form without a token", () => {
    const page = doc(csci103Html);
    expect(findAddForm(page, "20263", "29966")).toBeNull();
    expect(findAddForm(page, "20271", "50390")).toBeNull();
    expect(findAddForm(doc(csci103Html.replaceAll('value="SCRUBBED"', 'value=""')), "20271", "29966")).toBeNull();
  });

  it("builds the request jquery-unobtrusive-ajax sends for that form", () => {
    const built = buildAddRequest({ path: "/api/section/20271/29966/add", token: "tok/+=1" });
    expect(built.url).toBe("https://webreg.usc.edu/api/section/20271/29966/add");
    expect(built.init.method).toBe("POST");
    expect(built.init.credentials).toBe("same-origin");
    expect(built.init.redirect).toBe("manual");
    expect(built.init.headers).toEqual({ Accept: "*/*", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" });
    expect(built.init.body).toBe("submit=&__RequestVerificationToken=tok%2F%2B%3D1&X-Requested-With=XMLHttpRequest");
    expect([...new URLSearchParams(built.init.body).entries()]).toEqual([
      ["submit", ""],
      ["__RequestVerificationToken", "tok/+=1"],
      ["X-Requested-With", "XMLHttpRequest"],
    ]);
  });
});

describe("only adding is possible", () => {
  it("allows a course-page read and an add, and nothing else", () => {
    expect(isAllowedBinRequest("GET", coursePageUrl("CSCI-103"))).toBe(true);
    expect(isAllowedBinRequest("POST", "https://webreg.usc.edu/api/section/20271/29966/add")).toBe(true);
    const refused: [string, string][] = [
      ["POST", "https://webreg.usc.edu/api/section/20271/29966/drop"],
      ["POST", "https://webreg.usc.edu/api/section/20271/29966/remove"],
      ["POST", "https://webreg.usc.edu/api/section/20271/29966/register"],
      ["POST", "https://webreg.usc.edu/api/section/20271/29966/add/../drop"],
      ["POST", "https://webreg.usc.edu/api/Section/Add"],
      ["POST", "https://webreg.usc.edu/api/section/20271/29966/add?action=drop"],
      ["POST", "https://webreg.usc.edu/Checkout"],
      ["POST", "https://webreg.usc.edu/CourseBin"],
      ["POST", "https://webreg.usc.edu/RegisteredCourses"],
      ["POST", "https://webreg.usc.edu/Courses?Program=CSCI&Course=CSCI-103"],
      ["POST", "https://evil.example/api/section/20271/29966/add"],
      ["POST", "http://webreg.usc.edu/api/section/20271/29966/add"],
      ["GET", "https://webreg.usc.edu/api/section/20271/29966/add"],
      ["PUT", "https://webreg.usc.edu/api/section/20271/29966/add"],
      ["DELETE", "https://webreg.usc.edu/api/section/20271/29966/add"],
      ["GET", "https://webreg.usc.edu/Checkout"],
      ["GET", "https://webreg.usc.edu/terms?handler=TermSelect&term=20263"],
      ["GET", "https://webreg.usc.edu/Courses?Program=CSCI&Course=CSCI-103&handler=Drop"],
      ["GET", "https://webreg.usc.edu/Courses?Program=MATH&Course=CSCI-103"],
      ["GET", "not a url"],
    ];
    for (const [method, url] of refused) expect(isAllowedBinRequest(method, url), `${method} ${url}`).toBe(false);
  });

  it("refuses to build a post to anything but the add action", () => {
    expect(() => buildAddRequest({ path: "/api/section/20271/29966/drop", token: "t" })).toThrow(/Refusing/);
    expect(() => buildAddRequest({ path: "/Checkout", token: "t" })).toThrow(/Refusing/);
  });

  it("blocks a disallowed request before it reaches the network", async () => {
    const network = vi.fn(async () => new Response(""));
    const guarded = guardedFetcher(network);
    await expect(guarded("https://webreg.usc.edu/Checkout", { method: "POST" })).rejects.toThrow(/Blocked/);
    await expect(guarded("https://webreg.usc.edu/api/section/20271/29966/drop", { method: "POST" })).rejects.toThrow(/Blocked/);
    expect(network).not.toHaveBeenCalled();
  });

  it("posts nothing when a tampered page points its buttons at drop or checkout", async () => {
    const tampered = (html: string) => html.replace(/data-ajax-url="\/api\/section\/20271\/(\w+)\/add"/g, (_m, id) => (id === "29966" ? `data-ajax-url="/Checkout"` : `data-ajax-url="/api/section/20271/${id}/drop"`));
    const web = fakeWebReg({ page: (code) => new Response(tampered(PAGES[code]), { status: 200 }) });
    const service = createCourseBinService(web.fetcher);
    expect(await service.prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103", "PHYS-151"] })).toEqual({ ok: true, activeTerm: "20271" });
    for (const item of binItems(DATA, SCHEDULE)) {
      const res = await service.add({ type: ADD_TYPE, termCode: "20271", courseCode: item.courseCode, sectionId: item.sectionId });
      expect(res.outcome).toBe("failed");
    }
    expect(web.posts()).toEqual([]);
    expectOnlyReadsAndAdds(web.seen);
  });
});

describe("WebReg's answer to an add", () => {
  const json = (v: unknown) => JSON.stringify(v);

  it("reads success, already-present and failure with WebReg's message", () => {
    expect(classifyAddResponse({ status: 200, body: json({ success: true, message: "Added to myCourseBin" }) })).toEqual({ outcome: "added", message: "Added to myCourseBin" });
    expect(classifyAddResponse({ status: 200, body: "" })).toEqual({ outcome: "added", message: null });
    expect(classifyAddResponse({ status: 200, body: json("Section 29966 is already in your myCourseBin.") }).outcome).toBe("already");
    expect(classifyAddResponse({ status: 409, body: json({ message: "Course already exists in course bin" }) }).outcome).toBe("already");
    expect(classifyAddResponse({ status: 200, body: json({ success: false, message: "Section is closed" }) })).toEqual({ outcome: "failed", message: "Section is closed" });
    expect(classifyAddResponse({ status: 200, body: json({ Message: "Unable to add section: unit limit exceeded" }) })).toEqual({ outcome: "failed", message: "Unable to add section: unit limit exceeded" });
    expect(classifyAddResponse({ status: 500, body: "<html><body><h1>Error.</h1><p>An error occurred.</p></body></html>" })).toEqual({ outcome: "failed", message: "Error. An error occurred." });
    expect(classifyAddResponse({ status: 400, body: "" })).toEqual({ outcome: "failed", message: "WebReg answered HTTP 400." });
  });

  it("treats a redirect, 401/403 or the sign-in page as a session problem", () => {
    expect(classifyAddResponse({ status: 0, type: "opaqueredirect", body: "" }).outcome).toBe("auth");
    expect(classifyAddResponse({ status: 401, body: "" }).outcome).toBe("auth");
    expect(classifyAddResponse({ status: 403, body: "" }).outcome).toBe("auth");
    expect(classifyAddResponse({ status: 200, body: "<html><head><title>USC Sign In</title></head><body><form action='/login'></form></body></html>" }).outcome).toBe("auth");
  });
});

describe("content script service", () => {
  it("reads each course page once, then adds every section with that page's own URL and token", async () => {
    const web = fakeWebReg({
      answers: {
        "29900": () => new Response(JSON.stringify({ message: "Section 29900 is already in your myCourseBin." }), { status: 200 }),
        "50390": () => new Response(JSON.stringify({ success: false, message: "Section 50390 is cancelled." }), { status: 200 }),
      },
    });
    const service = createCourseBinService(web.fetcher);
    expect(await service.prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103", "PHYS-151"] })).toEqual({ ok: true, activeTerm: "20271" });
    const results: Record<string, BinAddResponse> = {};
    for (const item of binItems(DATA, SCHEDULE)) results[item.sectionId] = await service.add({ type: ADD_TYPE, termCode: "20271", courseCode: item.courseCode, sectionId: item.sectionId });

    expect(Object.fromEntries(Object.entries(results).map(([id, r]) => [id, r.outcome]))).toEqual({
      "29966": "added",
      "29903": "added",
      "29900": "already",
      "50381": "added",
      "50383": "added",
      "50390": "failed",
    });
    expect(results["50390"].message).toBe("Section 50390 is cancelled.");

    const gets = web.seen.filter((s) => s.method === "GET");
    expect(gets.map((s) => s.url)).toEqual(["https://webreg.usc.edu/Courses?Program=CSCI&Course=CSCI-103", "https://webreg.usc.edu/Courses?Program=PHYS&Course=PHYS-151"]);
    expect(gets.every((s) => s.init.credentials === "same-origin" && s.init.redirect === "manual")).toBe(true);
    const posts = web.posts();
    expect(posts.map((s) => s.url)).toEqual(ALL_IDS.map((id) => `https://webreg.usc.edu/api/section/20271/${id}/add`));
    expect(posts.map((s) => new URLSearchParams(s.init.body as string).get("__RequestVerificationToken"))).toEqual(["token-CSCI-103", "token-CSCI-103", "token-CSCI-103", "token-PHYS-151", "token-PHYS-151", "token-PHYS-151"]);
    expectOnlyReadsAndAdds(web.seen);
  });

  it("refuses a term mismatch before anything is added", async () => {
    const web = fakeWebReg({ activeTerm: "20263" });
    const service = createCourseBinService(web.fetcher);
    const prep = await service.prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103", "PHYS-151"] });
    expect(prep).toMatchObject({ ok: false, reason: "term-mismatch", activeTerm: "20263" });
    // Even when asked directly, an add on a page for another term is refused.
    expect((await service.add({ type: ADD_TYPE, termCode: "20271", courseCode: "CSCI-103", sectionId: "29966" })).outcome).toBe("term-mismatch");
    expect(web.posts()).toEqual([]);
  });

  it("reports a session problem when WebReg redirects or does not show its course page", async () => {
    const redirect = fakeWebReg({ page: () => opaqueRedirect() });
    expect(await createCourseBinService(redirect.fetcher).prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103"] })).toMatchObject({ ok: false, reason: "auth" });
    const signIn = fakeWebReg({ page: () => new Response("<html><title>Sign in</title><form action='/login'></form></html>", { status: 200 }) });
    expect(await createCourseBinService(signIn.fetcher).prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103"] })).toMatchObject({ ok: false, reason: "auth" });
    const expired = fakeWebReg({ answers: { "29966": opaqueRedirect } });
    const service = createCourseBinService(expired.fetcher);
    await service.prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103"] });
    expect((await service.add({ type: ADD_TYPE, termCode: "20271", courseCode: "CSCI-103", sectionId: "29966" })).outcome).toBe("auth");
  });

  it("fails a section the page does not list without posting", async () => {
    const web = fakeWebReg();
    const service = createCourseBinService(web.fetcher);
    await service.prepare({ type: PREPARE_TYPE, termCode: "20271", courseCodes: ["CSCI-103"] });
    const res = await service.add({ type: ADD_TYPE, termCode: "20271", courseCode: "CSCI-103", sectionId: "99999" });
    expect(res).toEqual({ outcome: "failed", message: `WebReg's CSCI-103 page has no "Add to myCourseBin" button for section 99999.` });
    expect(web.posts()).toEqual([]);
  });

  it("answers only this extension's app page, and only well-formed requests", async () => {
    const service = { prepare: vi.fn(async () => ({ ok: true as const, activeTerm: "20271" })), add: vi.fn(async () => ({ outcome: "added" as const, message: null })) };
    const ext = { id: "ext-id", appUrl: "chrome-extension://ext-id/index.html" };
    const app = { id: "ext-id", url: "chrome-extension://ext-id/index.html?embedded=1" };
    const add = { type: ADD_TYPE, termCode: "20271", courseCode: "CSCI-103", sectionId: "29966" };
    expect(handleCourseBinMessage(service, { type: "usm:seats" }, app, ext)).toBeNull();
    expect(handleCourseBinMessage(service, add, { id: "other", url: app.url }, ext)).toBeNull();
    expect(handleCourseBinMessage(service, add, { id: "ext-id", url: "https://webreg.usc.edu/Courses" }, ext)).toBeNull();
    expect(await handleCourseBinMessage(service, { ...add, sectionId: "1/../drop" }, app, ext)).toMatchObject({ outcome: "failed" });
    expect(await handleCourseBinMessage(service, { ...add, termCode: "spring" }, app, ext)).toMatchObject({ outcome: "failed" });
    expect(service.add).not.toHaveBeenCalled();
    expect(await handleCourseBinMessage(service, add, app, ext)).toEqual({ outcome: "added", message: null });
    expect(service.add).toHaveBeenCalledWith(add);
  });
});

describe("the run", () => {
  it("lists every component of every course, once", () => {
    expect(binItems(DATA, SCHEDULE).map((i) => `${i.courseCode} ${i.typeLabel} ${i.sectionId}`)).toEqual([
      "CSCI-103 Lecture 29966",
      "CSCI-103 Lab 29903",
      "CSCI-103 Quiz 29900",
      "PHYS-151 Lecture 50381",
      "PHYS-151 Discussion 50383",
      "PHYS-151 Lab 50390",
    ]);
  });

  it("adds one section at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const transport: BinTransport = {
      prepare: async () => ({ ok: true, activeTerm: "20271" }),
      add: async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { outcome: "added", message: null };
      },
    };
    const end = await runBinAdd(transport, "20271", binItems(DATA, SCHEDULE), () => {});
    expect(end).toEqual({ kind: "done" });
    expect(maxInFlight).toBe(1);
  });

  it("stops cleanly on a session failure and keeps what it already did", async () => {
    const answers: BinAddResponse[] = [
      { outcome: "added", message: null },
      { outcome: "already", message: "Already in your bin." },
      { outcome: "auth", message: "Sign in again." },
    ];
    const add = vi.fn(async () => answers.shift() ?? { outcome: "added" as const, message: null });
    let last: BinItemResult[] = [];
    const end = await runBinAdd({ prepare: vi.fn(), add }, "20271", binItems(DATA, SCHEDULE), (r) => (last = r));
    expect(end).toEqual({ kind: "stopped", reason: "auth", message: "Sign in again." });
    expect(add).toHaveBeenCalledTimes(3);
    expect(last.map((r) => r.status)).toEqual(["added", "already", "failed", "skipped", "skipped", "skipped"]);
    expect(last[2].message).toBe("Sign in again.");
  });
});

// ---- The dialog -------------------------------------------------------------------

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Add all to myCourseBin dialog", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (transport: BinTransport | null, onClose = vi.fn()) => act(() => root.render(<CourseBinDialog data={DATA} schedule={SCHEDULE} index={0} transport={transport} onClose={onClose} />));
  const button = (label: RegExp) => Array.from(host.querySelectorAll("button")).find((b) => label.test(b.textContent ?? ""))!;
  const rows = () => Array.from(host.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent!.replace(/\s+/g, " ").trim()));
  const results = () =>
    Array.from(host.querySelectorAll("tbody tr")).map((tr) => {
      const status = tr.querySelector(".bin-status")?.textContent?.trim() ?? "";
      const message = tr.querySelector(".bin-message")?.textContent?.trim();
      return message ? `${status}: ${message}` : status;
    });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  };

  it("confirms the full list before anything is sent, then shows each section's result", async () => {
    const web = fakeWebReg({
      answers: {
        "29900": () => new Response(JSON.stringify("Section 29900 is already in your myCourseBin."), { status: 200 }),
        "50390": () => new Response(JSON.stringify({ success: false, message: "Section 50390 is cancelled." }), { status: 200 }),
      },
    });
    render(createCourseBinService(web.fetcher));

    expect(host.querySelector("[role=dialog]")?.textContent).toMatch(/only adds: nothing is registered, dropped, checked out or removed/);
    expect(rows()).toEqual([
      ["CSCI-103", "Lecture", "29966"],
      ["CSCI-103", "Lab", "29903"],
      ["CSCI-103", "Quiz", "29900"],
      ["PHYS-151", "Lecture", "50381"],
      ["PHYS-151", "Discussion", "50383"],
      ["PHYS-151", "Lab", "50390"],
    ]);
    expect(web.seen).toEqual([]);

    await act(async () => button(/Add 6 sections/).click());
    await settle();

    expect(results()).toEqual(["Added", "Added", "Already in bin: Section 29900 is already in your myCourseBin.", "Added", "Added", "Failed: Section 50390 is cancelled."]);
    expect(host.textContent).toMatch(/Added 4, 1 already in your bin, 1 failed\./);
    expect(web.posts()).toHaveLength(6);
    expectOnlyReadsAndAdds(web.seen);
  });

  it("refuses a term mismatch with the term-switch link and adds nothing", async () => {
    const web = fakeWebReg({ activeTerm: "20263" });
    render(createCourseBinService(web.fetcher));
    await act(async () => button(/Add 6 sections/).click());
    await settle();

    expect(host.textContent).toMatch(/This schedule is for Spring 2027, but WebReg is showing Fall 2026, so nothing was added\./);
    const link = Array.from(host.querySelectorAll("a")).find((a) => /switch WebReg to Spring 2027/.test(a.textContent ?? ""));
    expect(link?.getAttribute("href")).toBe(webregTermSelectUrl("20271"));
    expect(button(/Check again/)).toBeTruthy();
    expect(web.posts()).toEqual([]);
  });

  it("leaves partial results visible when the session ends midway", async () => {
    const web = fakeWebReg({ answers: { "29900": opaqueRedirect } });
    render(createCourseBinService(web.fetcher));
    await act(async () => button(/Add 6 sections/).click());
    await settle();

    expect(results()).toEqual(["Added", "Added", "Failed: WebReg did not accept the request from this session. Sign in to WebReg again, then retry.", "Not tried", "Not tried", "Not tried"]);
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(/Stopped: .*Sign in to WebReg again/);
    expect(web.posts()).toHaveLength(3);
  });

  it("explains where it works and cannot start outside WebReg", () => {
    render(null);
    expect(host.textContent).toMatch(/works from WebReg itself/);
    expect(button(/Add 6 sections/).disabled).toBe(true);
  });
});

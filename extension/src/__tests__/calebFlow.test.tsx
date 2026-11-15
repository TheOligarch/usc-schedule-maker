// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Results } from "../screens/Results";
import { Requirements } from "../screens/Requirements";
import { Interview } from "../screens/Interview";
import { generateSchedules } from "../lib/engine";
import { interviewTurn } from "../lib/ai";
import { ELECTIVE_CATEGORIES, withElectiveInterests } from "../lib/electiveInterests";
import { compileRefinements, interpretRefinement, suggestRefinements } from "../lib/refinement";
import { feasibleSuggestions, proposeRefinement } from "../lib/refineCheck";
import { NEUTRAL_PLACEHOLDER } from "../components/ScheduleFeedback";
import type { RankedSchedule } from "../lib/contract-types";
import { buildRequest, defaultState, DEFAULT_PREFERENCES, interviewSignature, loadState, saveState, type AppState } from "../state";
import { liveTerm } from "./fixtures/liveTerm";
import { SAMPLE_TERM } from "../mocks/sampleTerm";

vi.mock("../lib/ai", () => {
  class AiError extends Error {}
  return { AI_IS_MOCK: false, AiError, explainSchedules: vi.fn(async () => ({ explanations: [] })), interviewTurn: vi.fn(), interpretFeedback: vi.fn(async () => { throw new AiError("offline in tests"); }) };
});
vi.mock("../lib/engine", async () => {
  const { generateSchedulesAsync } = await import("../../../engine/src/index");
  return { generateSchedules: vi.fn(async (data, req, opts) => ({ result: await generateSchedulesAsync(data, req, opts), isMock: false, truncated: false, elapsedMs: 1 })) };
});
const data = liveTerm();
const noop = () => {};
let root: Root, container: HTMLDivElement, current: AppState;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(generateSchedules).mockClear();
  vi.mocked(interviewTurn).mockReset();
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function initial(): AppState {
  return { ...defaultState(), step: "results", required: ["BISC-120"], sectionPins: { "BISC-120": ["13003"] }, interview: { preferences: { ...DEFAULT_PREFERENCES, breaks: "avoid" }, shortlists: [], summary: [] } };
}
function Harness({ start, screen = "results" }: { start: AppState; screen?: string }) {
  const [state, setState] = useState(start); current = state;
  const update = (patch: Partial<AppState>) => setState(s => ({ ...s, ...patch }));
  return screen === "requirements" ? <Requirements data={data} state={state} onChange={update} onNext={noop} />
    : screen === "interview" ? <Interview data={SAMPLE_TERM} state={state} sampleData={false} onChange={update} onBack={noop} onNext={noop} />
    : <Results data={data} state={state} onChange={update} onEdit={noop} binTransport={null} />;
}
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 80)); }); }
async function render(start: AppState, screen?: string) { await act(async () => root.render(<Harness start={start} screen={screen} />)); await settle(); }
/** The last schedule generation (not a one-schedule dry run of a change or suggestion) and its result. */
const lastGeneration = () => {
  const m = vi.mocked(generateSchedules).mock;
  let at = m.calls.length - 1;
  while (at > 0 && m.calls[at][2]?.limit === 1) at--;
  return { call: m.calls[at], result: m.results[at].value as ReturnType<typeof generateSchedules> };
};
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(text))!;
async function feedback(text: string) {
  const input = container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Refresh schedules and rankings").click()); await settle();
}

it("pins and clears a themed section in Requirements and carries it through saved requests", async () => {
  const start = { ...defaultState(), required: ["CORE-112"] };
  const original = interviewSignature(start);
  await render(start, "requirements");
  const toggle = container.querySelector<HTMLButtonElement>("button.pin-toggle")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  const select = container.querySelector<HTMLSelectElement>("#pin-CORE-112")!;
  expect(select.textContent).toContain("63538"); expect(select.textContent).toContain("Amy Cannon"); expect(container.querySelector('label[for="pin-CORE-112"]')!.textContent).toBe("Lecture");
  await act(async () => { select.value = "63538"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(interviewSignature(current)).not.toBe(original);
  saveState(current); expect(buildRequest(loadState()).sectionPins).toEqual({ "CORE-112": ["63538"] });
  const r = await generateSchedules(data, buildRequest(current), {});
  expect(r.result.schedules.every(s => s.courses[0].sectionIds.includes("63538"))).toBe(true);
  await act(async () => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(buildRequest(current).sectionPins).toEqual({});
});

it("applies Caleb's exact example in place, reruns real generation, preserves state and restores alternatives on undo", async () => {
  await render(initial());
  const before = vi.mocked(generateSchedules).mock.calls.length;
  await feedback("I dont want a bisc lab on friday");
  expect(vi.mocked(generateSchedules).mock.calls.length).toBeGreaterThan(before);
  const { call } = lastGeneration();
  expect(call[1].required).toEqual(["BISC-120"]); expect(call[1].sectionPins).toEqual({ "BISC-120": ["13003"] });
  expect(call[1].preferences.breaks).toBe("avoid");
  expect(call[1].excludedSectionIds).toEqual(expect.arrayContaining(["13005", "13008", "13010"]));
  const result = (await lastGeneration().result).result;
  expect(result.schedules.length).toBeGreaterThan(0);
  for (const s of result.schedules) for (const id of s.courses[0].sectionIds) if (data.sections[id].type === "LAB") expect(data.sections[id].meetings.every(m => !m.days.includes("Fri"))).toBe(true);
  expect(current.step).toBe("results"); expect(current.refinements[0].scheduleId).toBeTruthy();
  await act(async () => button("Clear feedback and refresh").click()); await settle();
  expect(current.refinements).toEqual([]);
  expect(lastGeneration().call[1].excludedSectionIds).toEqual([]);
});

it("warns and does not apply feedback that leaves no schedule, keeping schedules, pins and earlier feedback", async () => {
  await render({ ...initial(), sectionPins: { "BISC-120": ["13005"] } });
  await feedback("no classes before 7am");
  expect(current.refinements).toHaveLength(1);
  const shown = container.querySelectorAll("button.sched-item").length;
  const runs = vi.mocked(generateSchedules).mock.calls.length;
  await feedback("no BISC lab on Friday");
  expect(container.textContent).toContain("Not applied");
  expect(container.textContent).toContain("Your pinned BISC-120 section 13005 breaks “No BISC labs on Fri”");
  expect(current.refinements.map(r => r.summary)).toEqual(["No classes before 7:00 AM"]);
  expect(current.sectionPins).toEqual({ "BISC-120": ["13005"] });
  expect(container.querySelectorAll("button.sched-item").length).toBe(shown);
  // only dry runs happened (with and without the change); the displayed schedules were not regenerated
  const dry = vi.mocked(generateSchedules).mock.calls.slice(runs);
  expect(dry.length).toBeGreaterThan(0);
  for (const call of dry) expect(call[2]).toMatchObject({ limit: 1 });
  expect(container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!.value).toBe("no BISC lab on Friday");
  expect(container.textContent).not.toContain("No schedule fits all of your requirements"); // prior schedules and the box stay
});

it("explains a conflict with earlier feedback rather than a course", async () => {
  await render(initial());
  await feedback("no BISC lab on Friday");
  expect(current.refinements).toHaveLength(1);
  await feedback("BISC lab only on Friday");
  expect(container.textContent).toContain("Not applied");
  expect(container.textContent).toContain("conflicts with your earlier feedback “No BISC labs on Fri”");
  expect(current.refinements).toHaveLength(1);
});

it("rejects unsupported feedback without pretending it was applied; offers an in-place retry after generation errors", async () => {
  await render(initial());
  const before = vi.mocked(generateSchedules).mock.calls.length;
  await feedback("make it better somehow");
  expect(current.refinements).toHaveLength(0); expect(vi.mocked(generateSchedules).mock.calls).toHaveLength(before);
  expect(container.textContent).toContain("I couldn’t understand “make it better somehow”");
  await feedback("no classes before 10am");
  expect(current.refinements).toHaveLength(1);
  vi.mocked(generateSchedules).mockRejectedValueOnce(new Error("test search failure"));
  await act(async () => button("Clear feedback and refresh").click()); await settle();
  expect(container.textContent).toContain("test search failure");
  await act(async () => button("Retry schedule builder").click()); await settle();
  expect(container.textContent).not.toContain("test search failure");
});

it("elective categories allow multiple selections and survive the interview boundary into suggestions and ranking", async () => {
  const start = { ...defaultState(), step: "interview" as const, required: ["CSCI-201"], sectionPins: { "CSCI-201": ["30381"] }, slots: [{ id: "e", label: "Elective", kind: "elective" as const }] };
  const categories = Object.keys(ELECTIVE_CATEGORIES);
  vi.mocked(interviewTurn).mockResolvedValueOnce({ res: { done: false, question: { id: "slots-0", text: "Which areas interest you?", options: categories, allowFreeText: true } }, source: "ai" });
  vi.mocked(interviewTurn).mockImplementationOnce(async req => ({ res: withElectiveInterests(req, { done: true, preferences: DEFAULT_PREFERENCES, summary: [], shortlists: [{ label: "Elective", options: [] }] }, SAMPLE_TERM), source: "ai" }));
  await render(start, "interview");
  await act(async () => button(categories[0]).click()); await act(async () => button(categories[1]).click());
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
  await act(async () => button("Use selected interests").click()); await settle();
  const call = vi.mocked(interviewTurn).mock.calls.at(-1)![0];
  expect(call.history[0].answer).toContain(categories[0]); expect(call.history[0].answer).toContain(categories[1]); expect(call.sectionPins).toEqual(start.sectionPins);
  expect(current.interview!.shortlists[0].options.length).toBeGreaterThan(0);
  const req = buildRequest(current, SAMPLE_TERM);
  expect(Object.values(req.courseInterestScores!).every(n => n > 0)).toBe(true);
  expect(req.flexSlots[0].options).toEqual(current.interview!.shortlists[0].options.map(o => o.courseCode));
});

it("time feedback excludes actual meetings rather than changing only notes", async () => {
  const schedule = { id: "s", units: 4, score: 100, courses: [{ courseCode: "BISC-120", sectionIds: ["13003", "13005"] }], penalties: [], warnings: [] };
  const ctx = { data, codes: ["BISC-120"], schedule };
  const ids = async (text: string) => compileRefinements([await interpretRefinement(text, ctx, null)], data, ["BISC-120"]).excludedSectionIds;
  expect(await ids("no classes before 10am")).toContain("13005");
  expect(await ids("avoid this lab on Friday")).toEqual(["13005", "13008", "13010"]);
  await expect(interpretRefinement("no ZZZ-101 lab on Friday", ctx, null)).rejects.toThrow("not one of the courses");
  await expect(interpretRefinement("no CSCI lab on Friday", ctx, null)).rejects.toThrow("None of the courses you are scheduling is in CSCI");
});

it("shows refresh loading in place and prevents duplicate submits", async () => {
  await render(initial());
  const previous = await vi.mocked(generateSchedules).mock.results[0].value;
  let finish!: (r: typeof previous) => void;
  const real = vi.mocked(generateSchedules).getMockImplementation()!;
  // the dry run answers normally; the page's own refresh hangs until released
  vi.mocked(generateSchedules).mockImplementation((d, r, o) => o?.limit === 1 ? real(d, r, o) : new Promise(resolve => { finish = resolve; }));
  await feedback("no BISC lab on Friday");
  vi.mocked(generateSchedules).mockImplementation(real);
  expect(button("Refreshing schedules").disabled).toBe(true);
  expect(container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!.disabled).toBe(true);
  expect(current.step).toBe("results");
  await act(async () => finish(previous)); await settle();
  expect(button("Refresh schedules and rankings").disabled).toBe(true); // empty draft, ready for another change
  expect(container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!.disabled).toBe(false);
});

it("saved day exclusions also cover sections added by a newer live catalog", async () => {
  const state = initial();
  const schedule = { id: "s", units: 4, score: 100, courses: [{ courseCode: "BISC-120", sectionIds: ["13003", "13005"] }], penalties: [], warnings: [] };
  state.refinements = [await interpretRefinement("no BISC lab on Friday", { data, codes: ["BISC-120"], schedule }, null)];
  saveState(state);
  const updated = structuredClone(data);
  updated.sections["new-lab"] = { ...updated.sections["13005"], id: "new-lab" };
  updated.courses["BISC-120"].sectionIds.push("new-lab");
  expect(buildRequest(loadState(), updated).excludedSectionIds).toContain("new-lab");
});

it("refinements saved by 0.1.4 keep working after the upgrade", () => {
  localStorage.setItem("usm:state:v2", JSON.stringify({ ...initial(), sectionPins: { "BISC-120": "13003" }, refinements: [{ scheduleId: "s", text: "I dont want a bisc lab on friday", summary: "Exclude BISC lab on Fri", excludedSectionIds: ["13005"], rule: { code: "BISC", types: ["LAB", "LEC-LAB"], day: "Fri" } }] }));
  const state = loadState();
  expect(state.sectionPins).toEqual({ "BISC-120": ["13003"] });
  expect(state.refinements[0].summary).toBe("No BISC labs on Fri");
  expect(buildRequest(state, data).excludedSectionIds).toEqual(["13005", "13008", "13010"]);
});

const LONG: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const chips = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Suggestions from this schedule"] button')].map(b => b.textContent);
const placeholder = () => container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!.placeholder;
const fits = async (text: string, state: AppState, schedule: RankedSchedule) => (await proposeRefinement(text, data, state, schedule, { ai: null })).ok;

it("the refine box's suggested text comes from the displayed schedule and applies in place", async () => {
  await render(initial());
  const result = (await lastGeneration().result).result;
  const lab = result.schedules[0].courses[0].sectionIds.map((id: string) => data.sections[id]).find((s: { type: string }) => s.type === "LAB")!;
  const day = LONG[lab.meetings[0].days[0]];
  const input = container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!;
  expect(input.placeholder).toBe(`e.g. No BISC-120 lab on ${day}`);
  await act(async () => button(`No BISC-120 lab on ${day}`).click());
  expect(input.value).toBe(`No BISC-120 lab on ${day}`);
  await act(async () => button("Refresh schedules and rankings").click()); await settle();
  expect(current.refinements.map(r => r.summary)).toEqual([`No BISC-120 labs on ${lab.meetings[0].days[0]}`]);
  expect(container.textContent).toContain(`Applied “No BISC-120 labs on ${lab.meetings[0].days[0]}”`);
  // the suggestions follow the schedule now on screen, checked against the feedback just applied
  const next: RankedSchedule = (await lastGeneration().result).result.schedules[0];
  expect(chips()).toEqual(await feasibleSuggestions(data, current, next));
  expect(chips().length).toBeGreaterThan(0);
  expect(placeholder()).toBe(`e.g. ${chips()[0]}`);
});

it("hides an inferred suggestion that would leave no schedule, keeping the feasible ones", async () => {
  await render(initial());
  await act(async () => button(chips().find(c => c!.startsWith("No BISC-120 lab on"))!).click());
  await act(async () => button("Refresh schedules and rankings").click()); await settle();
  // with that lab day gone, excluding the next lab day too leaves no BISC-120 combination
  const next: RankedSchedule = (await lastGeneration().result).result.schedules[0];
  const nextLab = next.courses[0].sectionIds.map(id => data.sections[id]).find(s => s.type === "LAB")!;
  const infeasible = `No BISC-120 lab on ${LONG[nextLab.meetings[0].days[0]]}`;
  expect(suggestRefinements(data, next, Infinity)).toContain(infeasible);
  expect(await fits(infeasible, current, next)).toBe(false);
  expect(chips()).not.toContain(infeasible);
  expect(placeholder()).not.toContain(infeasible);
  expect(chips().length).toBeGreaterThan(0);
  for (const c of chips()) expect(await fits(c!, current, next)).toBe(true);
  expect(placeholder()).toBe(`e.g. ${chips()[0]}`);
  // typed text keeps the apply-time warning
  await feedback(infeasible);
  expect(container.textContent).toContain("Not applied");
  expect(current.refinements).toHaveLength(1);
});

it("shows no suggestion chips and no example placeholder when every inferred suggestion would leave nothing", async () => {
  await render(initial());
  const shown: RankedSchedule = (await lastGeneration().result).result.schedules[0];
  // pin every section on screen: any change to it leaves no schedule
  const pinned = { ...initial(), sectionPins: { "BISC-120": shown.courses[0].sectionIds } };
  await act(async () => root.unmount()); root = createRoot(container);
  await render(pinned);
  const schedule: RankedSchedule = (await lastGeneration().result).result.schedules[0];
  const candidates = suggestRefinements(data, schedule, Infinity);
  expect(candidates.length).toBeGreaterThan(0);
  for (const c of candidates) expect(await fits(c, current, schedule)).toBe(false);
  expect(container.querySelector("#schedule-feedback")).not.toBeNull();
  expect(container.querySelector('[aria-label="Suggestions from this schedule"]')).toBeNull();
  expect(placeholder()).toBe(NEUTRAL_PLACEHOLDER);
  for (const c of candidates) expect(placeholder()).not.toContain(c);
});

it("the sections card shows the freshness of the data in use, never a refresh schedule", async () => {
  await render(initial());
  expect(container.textContent).toMatch(/Live seat counts from classes\.usc\.edu, updated (just now|\d+ (minute|hour|day)s? ago)/);
  expect(container.textContent).not.toMatch(/nightly/i);
});

it("hides the refine box when the first generation finds no schedule, keeping the no-results guidance", async () => {
  const start = initial();
  start.times = { ...start.times, global: [{ start: "08:00", end: "09:00" }] };
  await render(start);
  expect(container.textContent).toContain("No schedule fits all of your requirements");
  expect(container.querySelector("#schedule-feedback")).toBeNull();
  expect(container.textContent).not.toContain("Refine your schedules");
  expect(container.querySelector('[aria-label="Suggestions from this schedule"]')).toBeNull();
  expect(container.textContent).not.toContain("Schedule feedback in effect");
});

it("when earlier feedback leaves nothing, lists only that feedback so it can be removed", async () => {
  const start = { ...initial(), sectionPins: { "BISC-120": ["13005"] } };
  start.refinements = [await interpretRefinement("no BISC lab on Friday", { data, codes: ["BISC-120"], schedule: null }, null)];
  await render(start);
  expect(container.textContent).toContain("No schedule fits all of your requirements");
  expect(container.querySelector("#schedule-feedback")).toBeNull();
  expect(container.textContent).toContain("Schedule feedback in effect");
  await act(async () => button("Clear feedback and refresh").click()); await settle();
  expect(current.refinements).toEqual([]);
  expect(container.querySelector("#schedule-feedback")).not.toBeNull();
});


it("caches suggestion checks per schedule and request, so revisiting costs no engine runs", async () => {
  const d = structuredClone(data); // a term the cache has not seen
  const state = initial();
  const schedule: RankedSchedule = (await generateSchedulesFor(state)).schedules[0];
  const first = await feasibleSuggestions(d, state, schedule);
  const runs = vi.mocked(generateSchedules).mock.calls.length;
  expect(runs).toBeGreaterThan(1);
  expect(await feasibleSuggestions(d, state, schedule)).toEqual(first);
  expect(vi.mocked(generateSchedules).mock.calls).toHaveLength(runs);
  // changed pins (or feedback, preferences, courses) are a new request: checked again
  await feasibleSuggestions(d, { ...state, sectionPins: {} }, schedule);
  expect(vi.mocked(generateSchedules).mock.calls.length).toBeGreaterThan(runs);
});
async function generateSchedulesFor(state: AppState) { return (await generateSchedules(data, buildRequest(state, data), { limit: 5 })).result; }

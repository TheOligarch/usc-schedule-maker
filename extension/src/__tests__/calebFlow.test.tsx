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
import { parseRefinement } from "../lib/refinement";
import { buildRequest, defaultState, DEFAULT_PREFERENCES, interviewSignature, loadState, saveState, type AppState } from "../state";
import { liveTerm } from "./fixtures/liveTerm";
import { SAMPLE_TERM } from "../mocks/sampleTerm";

vi.mock("../lib/ai", () => ({ AI_IS_MOCK: false, AiError: class extends Error {}, explainSchedules: vi.fn(async () => ({ explanations: [] })), interviewTurn: vi.fn() }));
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
  return { ...defaultState(), step: "results", required: ["BISC-120"], sectionPins: { "BISC-120": "13003" }, interview: { preferences: { ...DEFAULT_PREFERENCES, breaks: "avoid" }, shortlists: [], summary: [] } };
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
  const select = container.querySelector<HTMLSelectElement>("#pin-CORE-112")!;
  expect(select.textContent).toContain("63538"); expect(select.textContent).toContain("Amy Cannon"); expect(select.textContent).toContain("Lecture");
  await act(async () => { select.value = "63538"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(interviewSignature(current)).not.toBe(original);
  saveState(current); expect(buildRequest(loadState()).sectionPins).toEqual({ "CORE-112": "63538" });
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
  const call = vi.mocked(generateSchedules).mock.calls.at(-1)!;
  expect(call[1].required).toEqual(["BISC-120"]); expect(call[1].sectionPins).toEqual({ "BISC-120": "13003" });
  expect(call[1].preferences.breaks).toBe("avoid");
  expect(call[1].excludedSectionIds).toEqual(expect.arrayContaining(["13005", "13008", "13010"]));
  const result = (await vi.mocked(generateSchedules).mock.results.at(-1)!.value).result;
  expect(result.schedules.length).toBeGreaterThan(0);
  for (const s of result.schedules) for (const id of s.courses[0].sectionIds) if (data.sections[id].type === "LAB") expect(data.sections[id].meetings.every(m => !m.days.includes("Fri"))).toBe(true);
  expect(current.step).toBe("results"); expect(current.refinements[0].scheduleId).toBeTruthy();
  await act(async () => button("Clear feedback and refresh").click()); await settle();
  expect(current.refinements).toEqual([]);
  expect(vi.mocked(generateSchedules).mock.calls.at(-1)![1].excludedSectionIds).toEqual([]);
});

it("shows no alternatives when feedback conflicts with a pin and recovers here without changing the pin", async () => {
  await render({ ...initial(), sectionPins: { "BISC-120": "13005" } });
  await feedback("no BISC lab on Friday");
  expect(container.textContent).toContain("No feasible alternatives"); expect(current.sectionPins).toEqual({ "BISC-120": "13005" });
  await act(async () => button("Clear feedback and refresh").click()); await settle();
  expect(container.textContent).not.toContain("No feasible alternatives"); expect(current.sectionPins).toEqual({ "BISC-120": "13005" });
});

it("rejects unsupported feedback without pretending it was applied; offers an in-place retry after generation errors", async () => {
  await render(initial());
  const before = vi.mocked(generateSchedules).mock.calls.length;
  await feedback("make it better somehow");
  expect(current.refinements).toHaveLength(0); expect(vi.mocked(generateSchedules).mock.calls).toHaveLength(before);
  expect(container.textContent).toContain("Try");
  vi.mocked(generateSchedules).mockRejectedValueOnce(new Error("test search failure"));
  await feedback("no classes before 10am");
  expect(container.textContent).toContain("test search failure");
  await act(async () => button("Retry schedule builder").click()); await settle();
  expect(container.textContent).not.toContain("test search failure");
});

it("elective categories allow multiple selections and survive the interview boundary into suggestions and ranking", async () => {
  const start = { ...defaultState(), step: "interview" as const, required: ["CSCI-201"], sectionPins: { "CSCI-201": "30381" }, slots: [{ id: "e", label: "Elective", kind: "elective" as const }] };
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

it("time feedback excludes actual meetings rather than changing only notes", () => {
  const schedule = { id: "s", units: 4, score: 100, courses: [{ courseCode: "BISC-120", sectionIds: ["13003", "13005"] }], penalties: [], warnings: [] };
  expect(parseRefinement("no classes before 10am", data, schedule).excludedSectionIds).toContain("13005");
  expect(parseRefinement("avoid this lab on Friday", data, schedule).excludedSectionIds).toContain("13005");
  expect(() => parseRefinement("no ZZZ lab on Friday", data, schedule)).toThrow("No published sections");
});

it("shows refresh loading in place and prevents duplicate submits", async () => {
  await render(initial());
  const previous = await vi.mocked(generateSchedules).mock.results[0].value;
  let finish!: (r: typeof previous) => void;
  vi.mocked(generateSchedules).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await feedback("no BISC lab on Friday");
  expect(button("Refreshing schedules").disabled).toBe(true);
  expect(container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!.disabled).toBe(true);
  expect(current.step).toBe("results");
  await act(async () => finish(previous)); await settle();
  expect(button("Refresh schedules and rankings").disabled).toBe(true); // empty draft, ready for another change
  expect(container.querySelector<HTMLTextAreaElement>("#schedule-feedback")!.disabled).toBe(false);
});

it("saved day exclusions also cover sections added by a newer live catalog", () => {
  const state = initial();
  const schedule = { id: "s", units: 4, score: 100, courses: [{ courseCode: "BISC-120", sectionIds: ["13003", "13005"] }], penalties: [], warnings: [] };
  state.refinements = [parseRefinement("no BISC lab on Friday", data, schedule)];
  saveState(state);
  const updated = structuredClone(data);
  updated.sections["new-lab"] = { ...updated.sections["13005"], id: "new-lab" };
  expect(buildRequest(loadState(), updated).excludedSectionIds).toContain("new-lab");
});

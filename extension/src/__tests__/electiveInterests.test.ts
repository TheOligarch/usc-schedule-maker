import { afterEach, expect, it, vi } from "vitest";
import { electiveInterestScore, ELECTIVE_CATEGORIES } from "../lib/electiveInterests";
import { SAMPLE_TERM } from "../mocks/sampleTerm";
import { buildRequest, defaultState, DEFAULT_PREFERENCES } from "../state";
import type { InterviewRequest, InterviewDone } from "../lib/contract-types";
import { generateSchedulesAsync } from "../../../engine/src/index";

vi.mock("../lib/config", async orig => ({ ...(await orig<typeof import("../lib/config")>()), USE_MOCKS: false, SUPABASE_ANON_KEY: "test-anon" }));
const { interviewTurn } = await import("../lib/ai");
afterEach(() => vi.unstubAllGlobals());
const categories = Object.keys(ELECTIVE_CATEGORIES);
const done: InterviewDone = { done: true, preferences: DEFAULT_PREFERENCES, shortlists: [{ label: "Elective", options: [] }], summary: [] };
function req(label: string): InterviewRequest {
  return { termCode: "20271", required: [], slots: [{ label: "Elective", kind: "elective" }], history: [{ questionId: "slots-0", question: "Areas?", answer: label }] };
}

it("guarantees subject categories when the deployed service asks how close an elective should be to a major", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ done: false, question: { id: "slots-0", text: "How related to your major?", options: ["Close", "Different", "Anything"], allowFreeText: true } }))));
  const { res } = await interviewTurn({ ...req(""), history: [] }, SAMPLE_TERM);
  expect(res.done).toBe(false);
  if (!res.done) { expect(res.question.options).toEqual(categories); expect(res.question.text).toContain("areas"); expect(res.question.id).toBe("slots-0"); }
});

it("chosen categories change actual live-service suggestions and reach the ranking request", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(done))));
  const selections: string[][] = [];
  for (const label of [categories[0], categories[3]]) {
    const request = req(label);
    const { res } = await interviewTurn(request, SAMPLE_TERM);
    if (!res.done) throw new Error("expected done");
    const state = { ...defaultState(), slots: [{ id: "e", ...request.slots[0] }], history: request.history, interview: res };
    const engineRequest = buildRequest(state, SAMPLE_TERM);
    expect(engineRequest.flexSlots[0].options.length).toBeGreaterThan(0);
    for (const code of engineRequest.flexSlots[0].options) expect(electiveInterestScore(SAMPLE_TERM.courses[code], [label])).toBeGreaterThan(0);
    const result = await generateSchedulesAsync(SAMPLE_TERM, engineRequest);
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(result.schedules.every(s => engineRequest.flexSlots[0].options.includes(s.courses[0].courseCode))).toBe(true);
    selections.push(engineRequest.flexSlots[0].options);
  }
  expect(selections[0]).not.toEqual(selections[1]);
});

it("offline completion honors the same category choices and text matching", async () => {
  const request = req(categories[0]);
  request.history = [...request.history, ...Array.from({ length: 9 }, (_, i) => ({ questionId: `answered-${i}`, question: "?", answer: "No preference" }))];
  const { res } = await interviewTurn(request, SAMPLE_TERM, { offline: true });
  if (!res.done) throw new Error("expected done");
  expect(res.shortlists[0].options.length).toBeGreaterThan(0);
  expect(res.summary.some(s => s.includes(categories[0]))).toBe(true);
  const c = { ...SAMPLE_TERM.courses["CSCI-201"], code: "TEST-100", title: "Film studies", description: null };
  expect(electiveInterestScore(c, [categories[0]])).toBeGreaterThan(0);
  expect(electiveInterestScore({ ...c, title: "Earth systems" }, [categories[0]])).toBe(0);
});

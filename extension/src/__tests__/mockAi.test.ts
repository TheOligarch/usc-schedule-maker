import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewHistoryItem, InterviewRequest } from "../lib/contract-types";
import { mockInterview } from "../mocks/mockAi";
import { SAMPLE_TERM } from "../mocks/sampleTerm";

describe("scripted interview", () => {
  it("asks about difficulty, skips start/end time questions, and leaves comfort times unset", async () => {
    const history: InterviewHistoryItem[] = [];
    const req = (): InterviewRequest => ({ termCode: SAMPLE_TERM.term.code, required: [], slots: [{ label: "Elective", kind: "elective" }], history });
    for (;;) {
      const res = await mockInterview(req(), SAMPLE_TERM);
      if (res.done) {
        expect(res.preferences.comfortStart).toBeNull();
        expect(res.preferences.comfortEnd).toBeNull();
        break;
      }
      history.push({ questionId: res.question.id, question: res.question.text, answer: res.question.options[0] });
    }
    const ids = history.map((h) => h.questionId);
    expect(ids).not.toContain("mornings");
    expect(ids).not.toContain("evenings");
    const workload = history.find((h) => h.questionId === "workload")!;
    expect(workload.question).toBe("How difficult should those open-slot classes be?");
    expect(workload.answer).toBe("Easy");
  });
});

describe("offline course-aware interview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const cases = [
    { required: [], slots: [{ label: "Elective", kind: "elective" as const }], expected: [] },
    { required: ["WRIT-150"], slots: [], expected: ["writing-interests"] },
    { required: ["GESM-120g", "GESM-121g"], slots: [], expected: ["seminar-interests"] },
    { required: ["WRIT-150", "GESM-120g"], slots: [{ label: "Elective", kind: "elective" as const }], expected: ["writing-interests", "seminar-interests"] },
    { required: ["WRIT-150", "GESM-120g"], slots: [{ label: "General Education Seminar course", kind: "GE" as const, geCategory: "GESM" }], expected: ["writing-interests", "seminar-interests"] },
    { required: [], slots: [{ label: "General Education Seminar course", kind: "GE" as const, geCategory: "General Education Seminar" }], expected: ["seminar-interests"] },
  ];
  for (const [index, testCase] of cases.entries()) {
    it(`asks the relevant interests once and retains quick replies and free text (case ${index})`, async () => {
      const req: InterviewRequest = { termCode: SAMPLE_TERM.term.code, required: testCase.required, slots: testCase.slots, history: [] };
      for (let turn = 0; turn <= 10; turn++) {
        const pending = mockInterview(req, SAMPLE_TERM);
        await vi.runAllTimersAsync();
        const res = await pending;
        if (res.done) {
          expect(req.history.length).toBeLessThanOrEqual(10);
          const ids = req.history.map((h) => h.questionId);
          expect(ids.filter((id) => ["writing-interests", "seminar-interests"].includes(id))).toEqual(testCase.expected);
          expect(new Set(ids).size).toBe(ids.length);
          for (const [id, text] of [["writing-interests", "Film criticism"], ["seminar-interests", "Climate justice"]]) {
            expect(res.summary.some((s) => s.includes(text))).toBe(testCase.expected.includes(id));
            if (testCase.expected.includes(id)) expect(res.preferences.notes).toContain(text);
          }
          if (testCase.slots.length && testCase.slots.every((s) => s.kind === "GE")) expect(ids).not.toContain("interests");
          return;
        }
        const q = res.question;
        req.history.push({
          questionId: q.id,
          question: q.text,
          answer: q.id === "writing-interests" ? "Film criticism" : q.id === "seminar-interests" ? "Climate justice" : q.options[0],
          ...(q.id === "writing-interests" ? { freeText: "especially documentaries" } : {}),
        });
      }
      throw new Error("offline interview exceeded its budget");
    });
  }

  it("uses seminar interests for seminar shortlists", async () => {
    const base = Object.values(SAMPLE_TERM.courses)[0];
    const data = {
      ...SAMPLE_TERM,
      courses: {
        "GESM-110g": { ...base, code: "GESM-110g", title: "Literature", description: "Literature", ge: ["GESM"], crossListedWith: [] },
        "GESM-121g": { ...base, code: "GESM-121g", title: "Climate justice", description: "Climate justice", ge: ["GESM"], crossListedWith: [] },
      },
    };
    const history = ["seminar-interests", "workload", "format", "daySpread", "dayOff", "breaks", "maxGap", "anythingElse"].map((id) => ({
      questionId: id, question: "?", answer: id === "seminar-interests" ? "Climate justice" : "No preference",
    }));
    const pending = mockInterview({ termCode: data.term.code, required: [], slots: [{ label: "GESM course", kind: "GE", geCategory: "GESM" }], history }, data);
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.done).toBe(true);
    if (!res.done) throw new Error("expected a completed interview");
    expect(res.shortlists[0].options[0].courseCode).toBe("GESM-121g");
    expect(res.preferences.notes).toContain("Climate justice");
  });
});

import { describe, expect, it } from "vitest";
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

// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterviewImportance } from "../components/InterviewImportance";
import { Interview } from "../screens/Interview";
import { Priorities } from "../screens/Priorities";
import { interviewTurn } from "../lib/ai";
import { buildRequest, defaultState, DEFAULT_PREFERENCES, loadState, saveState, type AppState } from "../state";
import { SAMPLE_TERM } from "../mocks/sampleTerm";
import { fixture } from "../../../engine/test/fixture";
import { generateSchedulesAsync } from "../../../engine/src/index";

vi.mock("../lib/ai", () => ({ AI_IS_MOCK: false, AiError: class extends Error {}, interviewTurn: vi.fn() }));

const noop = () => {};

it("maps only stable backend/offline question IDs, independently of visible wording", () => {
  for (const [id, factor] of [
    ["day-spread", "daySpread"], ["daySpread", "daySpread"],
    ["breaks", "breaks"], ["max-gap", "breaks"], ["breaks-and-gap", "breaks"], ["maxGap", "breaks"],
  ]) {
    const html = renderToStaticMarkup(<InterviewImportance questionId={id} importance={defaultState().importance} onImportance={noop} />);
    expect(html).toContain(`id="interview-importance-${factor}"`);
    expect(html).toContain('aria-valuetext="5 of 10"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
  }
  for (const id of ["writing-interests", "seminar-interests", "slots-0", "interests", "workload", "format", "unknown", "toString"]) {
    expect(renderToStaticMarkup(<InterviewImportance questionId={id} importance={defaultState().importance} onImportance={noop} />)).toBe("");
  }
});

describe("importance follow-up steps in the interview", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: AppState;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    vi.mocked(interviewTurn).mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Harness({ initial }: { initial: AppState }) {
    const [state, setState] = useState(initial);
    current = state;
    useEffect(() => saveState(state), [state]);
    const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }));
    return state.step === "priorities"
      ? <Priorities importance={state.importance} onImportance={(importance) => update({ importance })} onBack={noop} onNext={() => update({ step: "interview" })} />
      : <Interview data={SAMPLE_TERM} sampleData={false} state={state} onChange={update} onBack={() => update({ step: "priorities" })} onNext={noop} />;
  }

  const slider = (factor: string) => container.querySelector<HTMLInputElement>(`#interview-importance-${factor}`)!;
  const click = async (selector: string) => {
    const button = container.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  };
  const setInput = async (input: HTMLInputElement, value: string) => {
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const ranges = () => container.querySelectorAll('input[type="range"]').length;
  const quickReplies = () => container.querySelectorAll(".quick-reply").length;
  const followupText = () => container.querySelector(".importance-followup .bubble-ai")?.textContent ?? null;
  const asked = () => vi.mocked(interviewTurn).mock.calls.map(([req]) => req.history.map((h) => h.questionId));
  const continueButton = '.importance-followup .btn-primary';

  /** The current step is the slider-only importance follow-up for one factor. */
  const expectFollowup = (factor: "daySpread" | "breaks") => {
    expect(followupText()).toBe(factor === "daySpread" ? "How important is matching your week layout?" : "How important is matching your breaks and longest-gap preferences?");
    expect(ranges()).toBe(1);
    expect(slider(factor)).not.toBeNull();
    expect(quickReplies()).toBe(0);
    expect(container.querySelector("#free-text")).toBeNull();
  };
  /** The current step is an ordinary topic question with no slider. */
  const expectTopic = () => {
    expect(followupText()).toBeNull();
    expect(ranges()).toBe(0);
    expect(quickReplies()).toBeGreaterThan(0);
  };

  for (const source of ["ai", "fallback", "mock"] as const) {
    it(`${source}: asks each weighted topic, then a slider-only importance step, and keeps answers and weights separate through navigation, resume and scoring`, async () => {
      const ids = source === "mock" ? ["daySpread", "breaks", "maxGap", "interests"]
        : source === "fallback" ? ["day-spread", "breaks-and-gap", "seminar-interests"]
        : ["day-spread", "breaks", "max-gap", "writing-interests"];
      const preferences = { ...DEFAULT_PREFERENCES, daySpread: "compact" as const, breaks: "avoid" as const, maxGapMinutes: 30 };
      vi.mocked(interviewTurn).mockImplementation(async (req) => {
        const id = ids[req.history.length];
        // Identical wording proves that the follow-up binding comes from IDs.
        return { source, res: id
          ? { done: false, question: { id, text: "Choose your preference?", options: ["Choice A", "Choice B", "No preference"], allowFreeText: true } }
          : { done: true, preferences, shortlists: [], summary: ["You prefer fewer campus days.", "  • Please confirm these preferences or change any of them before you continue.  ", "You prefer to confirm project topics before class."] } };
      });
      const initial = defaultState();
      initial.step = "interview";
      initial.required = ["CSCI-201", "MATH-226"];
      await act(async () => root.render(<Harness initial={initial} />));

      // Week layout: the topic question first, without a slider.
      expectTopic();
      await setInput(container.querySelector<HTMLInputElement>("#free-text")!, "Campus days matter");
      await click(".quick-reply");
      expect(current.history).toEqual([{ questionId: ids[0], question: "Choose your preference?", answer: "Choice A", freeText: "Campus days matter" }]);
      expect(current.importanceFollowup).toBe(ids[0]);
      // Then its importance as a separate slider-only step; the next topic is not requested yet.
      expectFollowup("daySpread");
      expect(asked()).toEqual([[]]);
      await setInput(slider("daySpread"), "9");
      expect(slider("daySpread").getAttribute("aria-valuetext")).toBe("9 of 10");
      expect(current.importance.daySpread).toBe(9);
      expect(current.history[0]).not.toHaveProperty("importance");

      // A saved session resumes on the open follow-up without re-asking the topic.
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<Harness initial={loadState()} />));
      expectFollowup("daySpread");
      expect(slider("daySpread").value).toBe("9");
      expect(asked()).toEqual([[]]);

      // Back and forward keep the follow-up open with its value.
      await click(".step-footer .btn-ghost");
      expect(ranges()).toBe(3);
      await click(".step-footer .btn-primary");
      expectFollowup("daySpread");
      expect(slider("daySpread").value).toBe("9");

      // Continue moves on to the breaks topic, again without a slider.
      await click(continueButton);
      expect(current.importanceFollowup).toBeNull();
      expectTopic();
      expect(asked()).toEqual([[], [ids[0]]]);

      // Changing the week-layout answer re-asks that topic once, then its follow-up keeps the weight.
      await click('[aria-label="Change your answer to question 1"]');
      expectTopic();
      expect(current.history).toEqual([]);
      await click(".quick-reply");
      expectFollowup("daySpread");
      expect(slider("daySpread").value).toBe("9");
      await click(continueButton);
      expectTopic();

      // Breaks: topic, then slider-only follow-up, then the next question.
      await click(".quick-reply");
      expect(current.history.map((h) => h.questionId)).toEqual(ids.slice(0, 2));
      expectFollowup("breaks");
      await setInput(slider("breaks"), "8");
      expect(current.importance.breaks).toBe(8);
      await click(continueButton);
      expectTopic();
      if (source !== "fallback") {
        // The longest-gap topic shares the breaks weight, which was already asked: no repeat step.
        await click(".quick-reply");
        expectTopic();
      }
      // Interest questions get no follow-up; answering the last one finishes the interview.
      await click(".quick-reply");
      expect(followupText()).toBeNull();
      expect(current.history.map((h) => h.questionId)).toEqual(ids);
      expect(current.history.every((h) => !("importance" in h))).toBe(true);
      expect(current.history.length).toBeLessThanOrEqual(10);
      // Follow-ups never reach the model's history or question budget.
      for (const history of asked()) expect(history).toEqual(ids.slice(0, history.length));
      expect(current.importance).toEqual({ ...initial.importance, daySpread: 9, breaks: 8 });
      expect(slider("daySpread").value).toBe("9");
      expect(slider("breaks").value).toBe("8");

      // Review guidance is fixed text for every source; real conclusions stay editable.
      const instruction = "Please confirm these preferences or change any of them before you continue.";
      expect(container.querySelector(".summary")!.textContent).not.toContain(instruction);
      expect(Array.from(container.querySelectorAll("p")).filter((p) => p.textContent === instruction)).toHaveLength(1);
      const summaryInputs = () => Array.from(container.querySelectorAll<HTMLInputElement>(".summary input"));
      expect(summaryInputs().map((input) => input.value)).toEqual(["You prefer fewer campus days.", "You prefer to confirm project topics before class."]);
      await setInput(summaryInputs()[0], "You prefer classes spread out.");
      expect(current.interview!.summary).toEqual(["You prefer classes spread out.", "You prefer to confirm project topics before class."]);
      await click('[aria-label="Remove summary point 2"]');
      expect(summaryInputs().map((input) => input.value)).toEqual(["You prefer classes spread out."]);

      // Summary editing and a persisted-session remount use the same weights.
      await setInput(slider("daySpread"), "6");
      const restored = loadState();
      expect(restored.importance).toEqual({ ...initial.importance, daySpread: 6, breaks: 8 });
      expect(restored.interview?.preferences).toEqual(preferences);
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<Harness initial={restored} />));
      expect(slider("daySpread").value).toBe("6");
      expect(slider("breaks").value).toBe("8");
      expect(summaryInputs().map((input) => input.value)).toEqual(["You prefer classes spread out."]);
      expect(container.textContent!.split(instruction)).toHaveLength(2);
      const req = buildRequest(current);
      expect(req.importance.daySpread).toBe(6);
      expect(req.importance.breaks).toBe(8);
      const ranked = await generateSchedulesAsync(fixture, req, { limit: 100 });
      const lowWeights = await generateSchedulesAsync(fixture, { ...req, importance: { ...req.importance, daySpread: 1, breaks: 1 } }, { limit: 100 });
      expect(ranked.totalValid).toBe(lowWeights.totalValid);
      for (const pattern of [/prefer fewer days/, /longer than 30 minutes/]) {
        const fit = ranked.schedules.find((s) => s.penalties.some((p) => pattern.test(p.message)))!;
        expect(fit).toBeDefined();
        const lower = lowWeights.schedules.find((s) => s.id === fit.id)!;
        expect(fit.penalties.find((p) => pattern.test(p.message))!.amount).toBeGreaterThan(lower.penalties.find((p) => pattern.test(p.message))!.amount);
      }
    });
  }
});

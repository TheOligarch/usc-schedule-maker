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

describe("contextual importance in the interview", () => {
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

  for (const source of ["ai", "fallback", "mock"] as const) {
    it(`${source}: edits context weights separately from answers, retains navigation/session state, and sends them to scoring`, async () => {
      const ids = source === "mock" ? ["daySpread", "breaks", "maxGap", "interests"]
        : source === "fallback" ? ["day-spread", "breaks-and-gap", "seminar-interests"]
        : ["day-spread", "breaks", "max-gap", "writing-interests"];
      const preferences = { ...DEFAULT_PREFERENCES, daySpread: "compact" as const, breaks: "avoid" as const, maxGapMinutes: 30 };
      vi.mocked(interviewTurn).mockImplementation(async (req) => {
        const id = ids[req.history.length];
        // Identical wording proves that contextual binding comes from IDs.
        return { source, res: id
          ? { done: false, question: { id, text: "Choose your preference?", options: ["Choice A", "Choice B", "No preference"], allowFreeText: true } }
          : { done: true, preferences, shortlists: [], summary: [] } };
      });
      const initial = defaultState();
      initial.step = "interview";
      initial.required = ["CSCI-201", "MATH-226"];
      await act(async () => root.render(<Harness initial={initial} />));
      expect(container.querySelectorAll('input[type="range"]').length).toBe(1);
      expect(slider("breaks")).toBeNull();
      await setInput(slider("daySpread"), "9");
      expect(slider("daySpread").getAttribute("aria-valuetext")).toBe("9 of 10");
      await setInput(container.querySelector<HTMLInputElement>("#free-text")!, "Campus days matter");
      await click(".quick-reply");
      expect(current.importance.daySpread).toBe(9);
      expect(current.history[0].answer).toBe("Choice A");
      expect(current.history[0].freeText).toBe("Campus days matter");
      expect(current.history[0]).not.toHaveProperty("importance");
      expect(slider("daySpread")).toBeNull();
      expect(container.querySelectorAll('input[type="range"]').length).toBe(1);
      await setInput(slider("breaks"), "8");
      expect(current.importance.breaks).toBe(8);

      // Back and forward remount Interview without losing values or answers.
      await click(".step-footer .btn-ghost");
      expect(container.querySelectorAll('input[type="range"]').length).toBe(3);
      expect(slider("breaks")).toBeNull();
      expect(container.querySelector("#imp-daySpread")).toBeNull();
      expect(container.querySelector("#imp-breaks")).toBeNull();
      await click(".step-footer .btn-primary");
      expect(slider("breaks").value).toBe("8");
      await click(".quick-reply");
      if (source !== "fallback") {
        expect(slider("breaks").value).toBe("8"); // max-gap shares the same saved weight
        await click(".quick-reply");
      }
      // Interest questions receive neither slider.
      expect(container.querySelectorAll('input[type="range"]').length).toBe(0);
      await click(".quick-reply");
      expect(current.history.map((h) => h.questionId)).toEqual(ids);
      expect(current.history.length).toBeLessThanOrEqual(10);
      expect(slider("daySpread").value).toBe("9");
      expect(slider("breaks").value).toBe("8");

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

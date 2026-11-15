import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Requirements } from "../screens/Requirements";
import { Interview } from "../screens/Interview";
import { buildRequest, defaultState, DEFAULT_PREFERENCES, friendlySlotLabels, interviewSignature, loadState, type AppState } from "../state";
import type { Course, TermData } from "../lib/contract-types";
import { SAMPLE_TERM } from "../mocks/sampleTerm";

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** Sample term re-coded with the live catalog prefixes the published term files use. */
const LIVE_CODES: Record<string, string> = { A: "ARTS", B: "HINQ", C: "SANA", D: "LIFE", E: "PSC", F: "QREA", G: "GPG", H: "GPH" };
const LIVE: TermData = {
  ...SAMPLE_TERM,
  courses: Object.fromEntries(
    Object.entries(SAMPLE_TERM.courses).map(([code, c]): [string, Course] => [code, { ...c, ge: c.ge.map((g) => LIVE_CODES[g] ?? g) }]),
  ),
};

/** State as saved by builds before friendly GE labels: label uses the raw prefix. */
function legacyState(): AppState {
  const state = defaultState();
  state.slots = [
    { id: "a", label: "ARTS course", kind: "GE", geCategory: "ARTS" },
    { id: "b", label: "ARTS course 2", kind: "GE", geCategory: "ARTS" },
    { id: "c", label: "HINQ course", kind: "GE", geCategory: "HINQ" },
    { id: "d", label: "Elective", kind: "elective" },
  ];
  state.interview = {
    preferences: DEFAULT_PREFERENCES,
    summary: [],
    shortlists: [
      { label: "ARTS course", options: [{ courseCode: "CTCS-190", reason: "" }] },
      { label: "ARTS course 2", options: [] },
      { label: "HINQ course", options: [] },
      { label: "Elective", options: [] },
    ],
  };
  state.interviewFor = interviewSignature(state);
  return state;
}

describe("GE slot labels with live catalog prefixes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows GE letters in the slot picker and slot chips", () => {
    const state = defaultState();
    state.slots = [{ id: "a", label: "GE-A course", kind: "GE", geCategory: "ARTS" }];
    const html = renderToStaticMarkup(<Requirements data={LIVE} state={state} onChange={noop} onNext={noop} />);
    expect(html).toContain("GE-A — The Arts");
    expect(html).toContain("GE-B — Humanistic Inquiry");
    expect(html).toContain('value="ARTS"');
    const visible = text(html);
    expect(visible).toContain("GE-A course");
    for (const code of Object.values(LIVE_CODES)) expect(visible).not.toMatch(new RegExp(`\\b${code}\\b`));
  });

  it("renames slots saved with raw prefixes and keeps their shortlists and category", () => {
    let stored = JSON.stringify(legacyState());
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_k: string, v: string) => { stored = v; } });
    const state = loadState();
    expect(state.slots.map((s) => [s.label, s.geCategory])).toEqual([
      ["GE-A course", "ARTS"],
      ["GE-A course 2", "ARTS"],
      ["GE-B course", "HINQ"],
      ["Elective", undefined],
    ]);
    expect(state.interview?.shortlists.map((s) => s.label)).toEqual(["GE-A course", "GE-A course 2", "GE-B course", "Elective"]);
    expect(state.interviewFor).toBe(interviewSignature(state));
    expect(buildRequest(state).flexSlots[0]).toEqual({ label: "GE-A course", options: ["CTCS-190"] });

    for (const html of [
      renderToStaticMarkup(<Requirements data={LIVE} state={state} onChange={noop} onNext={noop} />),
      renderToStaticMarkup(<Interview data={LIVE} sampleData={false} state={state} onChange={noop} onBack={noop} onNext={noop} />),
    ]) {
      const visible = text(html);
      expect(visible).toContain("GE-A course");
      expect(visible).toContain("GE-A — The Arts");
      expect(visible).not.toMatch(/\b(ARTS|HINQ)\b/);
    }
  });

  it("avoids label collisions and leaves current labels alone", () => {
    const state = defaultState();
    state.slots = [
      { id: "a", label: "GE-A course", kind: "GE", geCategory: "ARTS" },
      { id: "b", label: "ARTS course", kind: "GE", geCategory: "ARTS" },
      { id: "c", label: "Dornsife Core Literacy course", kind: "GE", geCategory: "DCL" },
    ];
    expect(friendlySlotLabels(state).slots.map((s) => s.label)).toEqual(["GE-A course", "GE-A course 2", "Dornsife Core Literacy course"]);
    const current = defaultState();
    current.slots = [{ id: "a", label: "GE-A course", kind: "GE", geCategory: "ARTS" }];
    expect(friendlySlotLabels(current)).toBe(current);
  });
});

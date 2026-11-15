import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSchedulesAsync } from "../../../engine/src/index";
import { SAMPLE_TERM } from "../mocks/sampleTerm";
import { buildRequest, defaultState, loadState } from "../state";
import { fixture } from "../../../engine/test/fixture";
import { mockGenerateSchedules } from "../mocks/mockEngine";
import { placedMeetings } from "../lib/schedule";

describe("real engine (engine/) on the sample term, via the UI's request builder", () => {
  it("returns ranked, conflict-free schedules for a typical request", async () => {
    const state = defaultState();
    state.required = ["CSCI-201", "MATH-225", "WRIT-340"];
    state.slots = [{ id: "s", label: "GE-A course", kind: "GE", geCategory: "A" }];
    state.interview = {
      preferences: { daySpread: "compact", breaks: "neutral", maxGapMinutes: 120, preferredDaysOff: ["Fri"], comfortStart: "10:00", comfortEnd: null, notes: null },
      shortlists: [{ label: "GE-A course", options: ["CTCS-190", "MUSC-102", "THTR-125"].map((courseCode) => ({ courseCode, reason: "" })) }],
      summary: [],
    };
    state.unitCap = 20;
    const res = await generateSchedulesAsync(SAMPLE_TERM, buildRequest(state), { limit: 25 });
    expect(res.totalValid).toBeGreaterThan(0);
    expect(res.schedules.length).toBeGreaterThan(0);
    for (const s of res.schedules) {
      expect(s.courses.map((c) => c.courseCode)).toEqual(expect.arrayContaining(["CSCI-201", "MATH-225", "WRIT-340"]));
      const placed = placedMeetings(SAMPLE_TERM, s);
      for (const a of placed) for (const b of placed) if (a !== b && a.day === b.day) expect(a.start < b.end && b.start < a.end).toBe(false);
    }
  });

  it("explains an impossible request with blockers", async () => {
    const state = defaultState();
    state.required = ["CSCI-201", "MATH-225"];
    state.unitCap = 4;
    const res = await generateSchedulesAsync(SAMPLE_TERM, buildRequest(state));
    expect(res.totalValid).toBe(0);
    expect(res.blockers.length).toBeGreaterThan(0);
  });
});


describe("rating preferences through saved state and the UI request boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const engine of ["real", "offline"] as const) {
    it(`${engine}: keeps lower-rated schedules and makes rating priority affect scores`, async () => {
      const run = async (rmp: number) => {
        vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ ...defaultState(), required: ["CSCI-201"], minRmp: 5, importance: { ...defaultState().importance, rmp } }) });
        const req = buildRequest(loadState());
        expect(req).not.toHaveProperty("minRmp");
        return engine === "real" ? generateSchedulesAsync(fixture, req) : mockGenerateSchedules(fixture, req);
      };
      const low = await run(1);
      const high = await run(10);
      expect(low.totalValid).toBe(3);
      expect(high.totalValid).toBe(3);
      expect(high.blockers.some((b) => b.constraint === "minRmp")).toBe(false);
      const lowerRated = (result: typeof low) => result.schedules.find((s) => s.courses[0].sectionIds.includes("30002"))!;
      expect(lowerRated(high)).toBeDefined();
      expect(lowerRated(high).score).toBeLessThan(lowerRated(low).score);
      expect(high.schedules[0].score).toBeGreaterThan(lowerRated(high).score);
      expect(high.schedules[0].courses[0].sectionIds).toContain("30001");
    });

    it(`${engine}: ignores direct legacy filters and retains unrated instructors`, async () => {
      for (const required of [["AHIS-120"], ["WRIT-150"]]) {
        const state = defaultState();
        state.required = required;
        const req = { ...buildRequest(state), minRmp: 5 };
        const result = engine === "real" ? await generateSchedulesAsync(fixture, req) : mockGenerateSchedules(fixture, req);
        expect(result.totalValid).toBeGreaterThan(0);
        expect(result.blockers.some((b) => b.constraint === "minRmp")).toBe(false);
        if (required[0] === "WRIT-150") expect(result.schedules.some((s) => s.penalties.some((p) => p.kind === "noRmp"))).toBe(true);
      }
    });
  }
});

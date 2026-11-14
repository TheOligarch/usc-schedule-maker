import { describe, expect, it } from "vitest";
import { generateSchedulesAsync } from "../../../engine/src/index";
import { SAMPLE_TERM } from "../mocks/sampleTerm";
import { buildRequest, defaultState } from "../state";
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

import { describe, expect, it } from "vitest";
import { allowedTimes, buildRequest, defaultState } from "../state";

describe("allowed times", () => {
  it("applies the global default to weekdays, honours per-day overrides and days off", () => {
    const state = defaultState();
    state.times = { global: [{ start: "09:00", end: "17:00" }], overrides: { Wed: [], Fri: [{ start: "09:00", end: "12:00" }] }, weekends: false };
    const allowed = allowedTimes(state.times);
    expect(allowed.Mon).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(allowed.Wed).toEqual([]);
    expect(allowed.Fri).toEqual([{ start: "09:00", end: "12:00" }]);
    expect(allowed.Sat).toEqual([]);
    state.times.weekends = true;
    expect(allowedTimes(state.times).Sat).toEqual([{ start: "09:00", end: "17:00" }]);
  });
});

describe("buildRequest", () => {
  it("aligns flex slots to the interview shortlists by label", () => {
    const state = defaultState();
    state.required = ["CSCI-201"];
    state.slots = [
      { id: "a", label: "GE-A course", kind: "GE", geCategory: "A" },
      { id: "b", label: "Elective", kind: "elective" },
    ];
    state.interview = {
      preferences: { daySpread: "compact", breaks: "avoid", maxGapMinutes: 60, preferredDaysOff: ["Fri"], comfortStart: null, comfortEnd: null, notes: null },
      shortlists: [{ label: "GE-A course", options: [{ courseCode: "CTCS-190", reason: "" }] }],
      summary: [],
    };
    const req = buildRequest(state);
    expect(req.flexSlots).toEqual([
      { label: "GE-A course", options: ["CTCS-190"] },
      { label: "Elective", options: [] },
    ]);
    expect(req.preferences.daySpread).toBe("compact");
    expect(req.unitCap).toBe(18);
  });
});

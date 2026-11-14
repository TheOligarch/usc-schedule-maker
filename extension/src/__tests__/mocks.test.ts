import { describe, expect, it } from "vitest";
import { mockGenerateSchedules } from "../mocks/mockEngine";
import { SAMPLE_TERM } from "../mocks/sampleTerm";
import { parseCourseSeats } from "../lib/seats";
import { searchCourses } from "../components/CourseSearch";
import { defaultState, buildRequest } from "../state";
import { placedMeetings } from "../lib/schedule";
import { toMin } from "../lib/time";

describe("sample term + mock engine", () => {
  it("builds ranked schedules whose meetings respect allowed times and never overlap", () => {
    const state = defaultState();
    state.required = ["CSCI-201", "MATH-225", "WRIT-340"];
    state.unitCap = 20;
    const req = buildRequest(state);
    const res = mockGenerateSchedules(SAMPLE_TERM, req, { limit: 100 });
    expect(res.totalValid).toBeGreaterThan(0);
    expect(res.schedules.length).toBeLessThanOrEqual(100);
    for (let i = 1; i < res.schedules.length; i++) expect(res.schedules[i - 1].score).toBeGreaterThanOrEqual(res.schedules[i].score);
    for (const s of res.schedules) {
      const placed = placedMeetings(SAMPLE_TERM, s);
      for (const p of placed) {
        expect(p.start).toBeGreaterThanOrEqual(toMin("08:00"));
        expect(p.end).toBeLessThanOrEqual(toMin("20:00"));
      }
      for (const a of placed) for (const b of placed) if (a !== b && a.day === b.day) expect(a.start < b.end && b.start < a.end).toBe(false);
    }
  });

  it("reports blockers when nothing fits", () => {
    const state = defaultState();
    state.required = ["CSCI-201", "MATH-225"];
    state.unitCap = 4;
    const res = mockGenerateSchedules(SAMPLE_TERM, buildRequest(state));
    expect(res.totalValid).toBe(0);
    expect(res.blockers[0].constraint).toBe("unitCap");
  });
});

describe("course search", () => {
  it("ranks code prefix matches first and skips excluded courses", () => {
    const hits = searchCourses(SAMPLE_TERM, "csci 2", new Set(["CSCI-201"]));
    expect(hits[0].code.startsWith("CSCI-2")).toBe(true);
    expect(hits.some((c) => c.code === "CSCI-201")).toBe(false);
    expect(searchCourses(SAMPLE_TERM, "cinema", new Set()).some((c) => c.code === "CTCS-190")).toBe(true);
  });
});

describe("live seats parsing", () => {
  it("reads the classes.usc.edu section fields we need", () => {
    const seats = parseCourseSeats({ sections: [{ sisSectionId: 30381, totalSeats: 40, registeredSeats: 40, hasDClearance: true }, { sisSectionId: "30382", totalSeats: 20, registeredSeats: 3 }, {}] });
    expect(seats["30381"]).toEqual({ registered: 40, total: 40, isFull: true, dClearance: true, cancelled: false });
    expect(seats["30382"].isFull).toBe(false);
    expect(Object.keys(seats)).toHaveLength(2);
    expect(parseCourseSeats(null)).toEqual({});
  });
});

import { expect, it } from "vitest";
import { liveTerm } from "./fixtures/liveTerm";
import { generateSchedulesAsync } from "../../../engine/src/index";
import { buildRequest, defaultState } from "../state";

it("public USC data preserves lecture professors and independently staffed components", async () => {
  const data = liveTerm();
  const state = { ...defaultState(), required: ["CSCI-170"] };
  state.times.global = [{ start: "08:00", end: "23:00" }];
  const result = await generateSchedulesAsync(data, buildRequest(state));
  expect(result.totalValid).toBeGreaterThan(0);
  for (const s of result.schedules) {
    const sections = s.courses[0].sectionIds.map(id => data.sections[id]);
    expect(sections.map(s => s.type).sort()).toEqual(["DIS", "LEC", "QZ"]);
    expect(sections.find(s => s.type === "LEC")!.instructors[0].last).toBe("Szabo");
    expect(sections.find(s => s.type === "DIS")!.instructors).toEqual([]);
  }
});

it("changing only the required lab's link code cannot yield a lecture+quiz without a lab", async () => {
  const data = liveTerm();
  const c = data.courses["BISC-220"];
  c.sectionIds = ["13011", "13140", "13120"];
  for (const id of Object.keys(data.sections)) if (!c.sectionIds.includes(id)) delete data.sections[id];
  const req = buildRequest({ ...defaultState(), required: [c.code] });
  expect((await generateSchedulesAsync(data, req)).totalValid).toBe(1);
  data.sections["13140"].linkCode = "X";
  expect((await generateSchedulesAsync(data, req)).totalValid).toBe(0);
});

it("a lab's published instructor may differ from the lecture professors without invalidating linkage", async () => {
  const data = liveTerm();
  const state = { ...defaultState(), required: ["BISC-220"], sectionPins: { "BISC-220": "13148" } };
  const result = await generateSchedulesAsync(data, buildRequest(state));
  expect(result.schedules.length).toBeGreaterThan(0);
  for (const schedule of result.schedules) {
    const sections = schedule.courses[0].sectionIds.map(id => data.sections[id]);
    const lab = sections.find(s => s.type === "LAB")!;
    const lecture = sections.find(s => s.type === "LEC")!;
    expect(lab.id).toBe("13148");
    expect(lab.instructors.map(i => i.last)).toEqual(["Castro"]);
    expect(lecture.instructors.map(i => i.last)).not.toContain("Castro");
    expect(lecture.linkCode).toBe(lab.linkCode);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLinkage, inferOnline, meetingsOf, normalize, prereqTextOf, sectionType } from "../src/normalize.ts";
import type { RawCourse, RawSection, RawTermDump } from "../src/usc.ts";

function rawSection(id: string, over: Partial<RawSection> = {}): RawSection {
  return {
    sisSectionId: id,
    linkCode: null,
    hasDClearance: false,
    schedule: [{ dayCode: "TH", days: ["Tue", "Thu"], startTime: "11:00", endTime: "12:20" }],
    totalSeats: 50,
    registeredSeats: 10,
    rnrMode: "Lecture",
    rnrModeCode: "C",
    session: { rnrSessionCode: "001", description: null },
    units: ["4.0"],
    instructors: [{ firstName: "Ada", lastName: "Lovelace" }],
    isCancelled: false,
    isFull: false,
    notes: null,
    description: null,
    name: null,
    classType: null,
    ...over,
  };
}

function code(prefix: string, number: string) {
  return { prefix, number, suffix: "", courseHyphen: `${prefix}-${number}`, courseSpace: `${prefix} ${number}` };
}

function rawCourse(home: string, matched: string, sections: RawSection[], over: Partial<RawCourse> = {}): RawCourse {
  const [hp = "", hn = ""] = home.split("-");
  const [mp = "", mn = ""] = matched.split("-");
  return {
    scheduledCourseCode: code(hp, hn),
    publishedCourseCode: code(hp, hn),
    matchedCourseCode: code(mp, mn),
    name: `Course ${matched}`,
    description: "<p>Desc</p>",
    courseUnits: [4],
    isCrossListed: home !== matched,
    sections,
    prerequisiteCourseCodes: null,
    corequisiteCourseCodes: null,
    courseRestrictions: null,
    majorRestrictions: null,
    schoolRestrictions: null,
    concurrentCourses: null,
    recommendedPrep: null,
    courseNotes: null,
    ...over,
  };
}

test("section types and meetings", () => {
  assert.equal(sectionType({ rnrModeCode: "CL", rnrMode: "Lecture/Lab" }), "LEC-LAB");
  assert.equal(sectionType({ rnrModeCode: "LR", rnrMode: "Lab Required" }), "LAB");
  assert.equal(sectionType({ rnrModeCode: "ZZ", rnrMode: "Studio" }), "OTHER");
  // days[] wins over the ambiguous dayCode; TBA meetings are dropped
  assert.deepEqual(meetingsOf({ schedule: [{ dayCode: "TH", days: ["Thu", "Tue"], startTime: "9:30", endTime: "10:50" }] }), [
    { days: ["Tue", "Thu"], start: "09:30", end: "10:50" },
  ]);
  assert.deepEqual(meetingsOf({ schedule: [{ dayCode: null, days: [], startTime: "TBA", endTime: "TBA" }] }), []);
});

test("online inference", () => {
  assert.equal(inferOnline("1", ["This section is online. The assigned room is available for streaming."]), true);
  assert.equal(inferOnline("1", ["This course is only open to students in the Online MBA program."]), true);
  assert.equal(inferOnline("1", ["MAT online only"]), true);
  assert.equal(inferOnline("1", ["EDL Online"]), true);
  assert.equal(inferOnline("1", ["Class meets weekly on Zoom."]), true);
  // not online
  assert.equal(inferOnline("1", ["Submit an individual instruction d-clearance request online here: https://music.usc.edu/students/x"]), false);
  assert.equal(inferOnline("1", ["Students can also purchase these online etc."]), false);
  assert.equal(inferOnline("1", ["This is a hybrid course with meetings online and on campus."]), false);
  assert.equal(inferOnline("14309", ["Section 14311 is for MBT WP online students only."]), false, "sentence about another section");
  assert.equal(inferOnline("14311", ["Section 14311 is for MBT WP online students only."]), true);
});

test("linkage classification (contract section 4)", () => {
  assert.equal(classifyLinkage([{ type: "LEC", linkCode: "A" }, { type: "DIS", linkCode: "A" }]), "coded");
  assert.equal(classifyLinkage([{ type: "LEC", linkCode: "A" }, { type: "LAB", linkCode: null }]), "coded");
  assert.equal(classifyLinkage([{ type: "LEC", linkCode: null }, { type: "DIS", linkCode: null }, { type: "DIS", linkCode: null }]), "single");
  assert.equal(classifyLinkage([{ type: "LEC", linkCode: null }, { type: "LEC", linkCode: null }]), "single", "nothing to pair");
  assert.equal(
    classifyLinkage([
      { type: "LEC", linkCode: null },
      { type: "DIS", linkCode: null },
      { type: "LEC", linkCode: null },
      { type: "DIS", linkCode: null },
    ]),
    "ambiguous",
  );
});

test("prereq text", () => {
  const c = rawCourse("CSCI-201", "CSCI-201", [], {
    prerequisiteCourseCodes: [{ requiredCourses: 1, courseOptions: [{ courseSpace: "CSCI 104" }, { courseSpace: "CSCI 114" }] }],
    courseRestrictions: [
      { groupDescription: "Junior", restrictionCode: "I" },
      { groupDescription: "Freshman", restrictionCode: "E" },
    ],
  });
  assert.equal(prereqTextOf(c), "Prerequisite: CSCI 104 or CSCI 114\nClass standing: open only to Junior; not open to Freshman");
});

test("normalize: cross-listing, cancelled, GE, units", () => {
  const shared = [rawSection("100"), rawSection("101", { rnrMode: "Discussion", rnrModeCode: "D", units: ["0.0"], instructors: null })];
  const dump: RawTermDump = {
    termCode: "20271",
    schools: [],
    programs: [
      { school: "LAS", program: "AMST", courses: [rawCourse("AMST-250", "AMST-250", shared)] },
      { school: "LAS", program: "ENGL", courses: [rawCourse("AMST-250", "ENGL-250", shared)] },
      {
        school: "ENGV",
        program: "CSCI",
        courses: [
          rawCourse("CSCI-499", "CSCI-499", [rawSection("200", { units: ["1.0", "2.0", "3.0", "4.0"] }), rawSection("201", { isCancelled: true })], {
            courseUnits: [1, 2, 3, 4],
          }),
        ],
      },
    ],
    ge: [{ requirement: "AGLOPERS", category: "GPG", courses: [rawCourse("AMST-250", "ENGL-250", shared)] }],
  };
  const { data, stats } = normalize(dump, { code: "20271", name: "Spring 2027" }, "2026-11-14T00:00:00Z");
  assert.deepEqual(Object.keys(data.courses).sort(), ["AMST-250", "CSCI-499", "ENGL-250"]);
  assert.deepEqual(data.sections["100"]?.courseCodes, ["AMST-250", "ENGL-250"]);
  assert.deepEqual(data.courses["AMST-250"]?.crossListedWith, ["ENGL-250"]);
  assert.deepEqual(data.courses["ENGL-250"]?.ge, ["GPG"]);
  assert.deepEqual(data.courses["AMST-250"]?.ge, []);
  assert.equal(data.sections["201"], undefined, "cancelled sections are dropped");
  assert.deepEqual(data.courses["CSCI-499"]?.sectionIds, ["200"]);
  assert.deepEqual(data.courses["CSCI-499"]?.units, { min: 1, max: 4 });
  assert.deepEqual(data.sections["200"]?.units, { min: 1, max: 4 });
  assert.equal(data.sections["101"]?.type, "DIS");
  assert.equal(data.courses["AMST-250"]?.description, "Desc");
  assert.equal(data.sections["100"]?.campus, null);
  assert.equal(stats.cancelled, 1);
});

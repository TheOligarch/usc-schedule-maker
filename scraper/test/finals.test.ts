import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { finalFor, firstDateOn, parseFinalsPage, parsePatternCell, parseRange, resolvePrefix } from "../src/finals.ts";
import type { Section } from "../src/types.ts";

const html = readFileSync(new URL("./fixtures/finals-spring-2027.html", import.meta.url), "utf8");
const programs = {
  byName: new Map([
    ["computer science", "CSCI"],
    ["mathematics", "MATH"],
    ["physics", "PHYS"],
    ["electrical and computer engineering", "EE"],
    ["german studies", "GERM"],
    ["french", "FREN"],
    ["performance vocal arts", "MPVA"],
    ["spanish", "SPAN"],
    ["accounting", "ACCT"],
    ["biological sciences", "BISC"],
    ["business administration", "BUAD"],
    ["east asian languages and cultures", "EALC"],
    ["italian", "ITAL"],
    ["chemistry", "CHEM"],
  ]),
};
const spring = { name: "Spring 2027", year: 2027 };

type S = Pick<Section, "type" | "session" | "meetings" | "courseCodes">;
const lec = (days: Section["meetings"][number]["days"], start: string, end: string, code = "XYZ-100"): S => ({
  type: "LEC",
  session: "001",
  meetings: [{ days, start, end }],
  courseCodes: [code],
});

test("parses the Spring 2027 chapter", () => {
  const p = parseFinalsPage(html, spring, programs);
  assert.ok(p.rules, p.warnings.join("\n"));
  assert.equal(p.sessionStart, "2027-01-11");
  assert.ok(p.rules.patterns.length >= 18);
  assert.equal(p.rules.firstPeriod.length, 2);
  assert.deepEqual(p.rules.saturday.morning, { date: "2027-05-08", start: "10:00", end: "12:00" });
  assert.deepEqual(p.rules.common.get("CSCI-201"), { date: "2027-05-11", start: "16:30", end: "18:30" });
  assert.deepEqual(p.rules.common.get("PHYS-135B"), { date: "2027-05-10", start: "16:30", end: "18:30" });
  assert.ok(p.rules.common.has("GERM-101"), "German -> German Studies");
  assert.ok(p.rules.common.has("EE-109"), "Electrical Engineering -> Electrical and Computer Engineering");
  assert.ok(p.rules.common.has("MPVA-261"), "second group after ';'");
  assert.deepEqual(p.warnings, []);
});

test("missing term chapter -> null rules + warning, not a throw", () => {
  const p = parseFinalsPage(html, { name: "Fall 2031", year: 2031 }, programs);
  assert.equal(p.rules, null);
  assert.match(p.warnings[0] ?? "", /no "Fall 2031" chapter/);
});

test("unrecognized table format -> null rules + warning", () => {
  const broken = html.replace(/Class Start Time/g, "Something Else");
  const p = parseFinalsPage(broken, spring, programs);
  assert.equal(p.rules, null);
  assert.match(p.warnings.join(" "), /format changed/);
});

test("cell parsers", () => {
  assert.deepEqual(parseRange("11:00 AM – 1:00 PM"), { start: "11:00", end: "13:00" });
  assert.deepEqual(parseRange("8:00 – 10:00 AM"), { start: "08:00", end: "10:00" });
  assert.deepEqual(parseRange("12:00 – 2:00 PM"), { start: "12:00", end: "14:00" });
  assert.deepEqual(parsePatternCell("9:00 or 9:30 or 10:00 – 10:50 AM TTh"), {
    family: "TTh",
    starts: [
      { start: 540, end: null },
      { start: 570, end: null },
      { start: 600, end: 650 },
    ],
  });
  assert.equal(parsePatternCell("12:00 or 12:30 or 1:00 PM TTh")?.starts[2]?.start, 13 * 60);
  assert.equal(parsePatternCell("Saturday mornings only"), null);
  assert.equal(resolvePrefix("Computer", programs), null, "ambiguous partial names are not guessed");
  assert.equal(firstDateOn(["Thu"], "2027-05-05", "2027-05-12"), "2027-05-06");
});

test("applies pattern, range, evening, common and Saturday rules", () => {
  const rules = parseFinalsPage(html, spring, programs).rules!;
  assert.deepEqual(finalFor(lec(["Mon", "Wed", "Fri"], "10:00", "10:50"), rules), { date: "2027-05-10", start: "08:00", end: "10:00" });
  // MW follows MWF ("first meeting on M or W or F")
  assert.deepEqual(finalFor(lec(["Mon", "Wed"], "08:30", "09:50"), rules), { date: "2027-05-10", start: "11:00", end: "13:00" });
  // TTh 10:00 depends on the end time
  assert.equal(finalFor(lec(["Tue", "Thu"], "10:00", "10:50"), rules)?.date, "2027-05-11");
  assert.equal(finalFor(lec(["Tue", "Thu"], "10:00", "11:50"), rules)?.start, "11:00");
  assert.equal(finalFor(lec(["Tue", "Thu"], "10:00", "11:20"), rules), null, "not a regular period -> null, never a guess");
  // 4-6 PM start: first scheduled class period in the exam window
  assert.deepEqual(finalFor(lec(["Tue", "Thu"], "16:00", "17:20"), rules), { date: "2027-05-06", start: "16:30", end: "18:30" });
  // once-weekly evening vs specific evening pattern
  assert.deepEqual(finalFor(lec(["Mon"], "18:00", "20:50"), rules), { date: "2027-05-10", start: "19:00", end: "21:00" });
  assert.deepEqual(finalFor(lec(["Mon", "Wed"], "18:00", "19:20"), rules), { date: "2027-05-05", start: "19:00", end: "21:00" });
  // common final wins over the pattern
  assert.deepEqual(finalFor(lec(["Tue", "Thu"], "11:00", "12:20", "CSCI-201"), rules), { date: "2027-05-11", start: "16:30", end: "18:30" });
  assert.equal(finalFor(lec(["Sat"], "09:00", "11:50"), rules)?.start, "10:00");
  // only lecture-type sections in the standard session get finals
  assert.equal(finalFor({ ...lec(["Mon", "Wed", "Fri"], "10:00", "10:50"), type: "DIS" }, rules), null);
  assert.equal(finalFor({ ...lec(["Mon", "Wed", "Fri"], "10:00", "10:50"), session: "048" }, rules), null);
  assert.equal(finalFor({ ...lec(["Mon"], "10:00", "10:50"), meetings: [] }, rules), null);
});

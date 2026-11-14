// Cut a small, real-data sample out of a scraped term file:
//   npm run fixture -- out/20271.json fixtures/sample-term.json
//
// Picks (contract section 1): a coded-linkage course, an ambiguous one, a cross-listed pair, a
// TBA course, an online course, a D-clearance course, a GE course, plus every section and RMP
// teacher those courses reference.

import { readFileSync, writeFileSync } from "node:fs";
import type { Course, TermData } from "./types.ts";

const [input = "out/20271.json", output = "fixtures/sample-term.json"] = process.argv.slice(2);
const data = JSON.parse(readFileSync(input, "utf8")) as TermData;
const courses = Object.values(data.courses);
const secs = (c: Course) => c.sectionIds.map((id) => data.sections[id]).filter((s) => s !== undefined);
const small = (c: Course, max = 12) => c.sectionIds.length <= max;

function pick(label: string, preferred: string[], pred: (c: Course) => boolean): Course {
  const c = preferred.map((code) => data.courses[code]).find((x) => x && pred(x)) ?? courses.find(pred);
  if (!c) throw new Error(`no course for ${label}`);
  console.log(`${label}: ${c.code}`);
  return c;
}

const chosen = new Map<string, Course>();
const add = (c: Course) => {
  chosen.set(c.code, c);
  // keep cross-listed partners so every section's courseCodes resolve inside the fixture
  for (const x of c.crossListedWith) if (data.courses[x]) chosen.set(x, data.courses[x] as Course);
};

add(pick("coded linkage", ["CSCI-201", "MATH-125"], (c) => c.linkage === "coded" && small(c)));
add(pick("ambiguous linkage", ["PHYS-151", "CHEM-322B"], (c) => c.linkage === "ambiguous"));
add(pick("cross-listed", ["AMST-250"], (c) => c.crossListedWith.length > 0 && small(c, 8)));
add(pick("TBA", [], (c) => small(c, 3) && secs(c).some((s) => s.meetings.length === 0) && c.code.startsWith("CSCI")));
add(pick("online", [], (c) => small(c, 4) && secs(c).some((s) => s.online)));
add(pick("D-clearance", ["CSCI-170"], (c) => small(c) && secs(c).some((s) => s.dClearance) && secs(c).some((s) => s.meetings.length > 0)));
add(pick("GE (QREA, single)", [], (c) => c.ge.includes("QREA") && c.linkage === "single" && small(c, 4)));
add(pick("full section", ["WRIT-150"], (c) => small(c, 6) && secs(c).some((s) => s.isFull) && c.linkage === "single"));

const sample: TermData = { term: data.term, courses: {}, sections: {}, rmp: {} };
for (const [code, c] of [...chosen].sort(([a], [b]) => a.localeCompare(b))) {
  sample.courses[code] = c;
  for (const id of c.sectionIds) {
    const s = data.sections[id];
    if (!s) continue;
    sample.sections[id] = s;
    for (const i of s.instructors) if (i.rmpId && data.rmp[i.rmpId]) sample.rmp[i.rmpId] = data.rmp[i.rmpId]!;
  }
}
// Trim courseCodes that point outside the sample (a section shared with a course we did not keep).
for (const s of Object.values(sample.sections)) s.courseCodes = s.courseCodes.filter((c) => sample.courses[c]);
for (const c of Object.values(sample.courses)) c.crossListedWith = c.crossListedWith.filter((x) => sample.courses[x]);

writeFileSync(output, `${JSON.stringify(sample, null, 2)}\n`);
console.log(`wrote ${output}: ${Object.keys(sample.courses).length} courses, ${Object.keys(sample.sections).length} sections, ${Object.keys(sample.rmp).length} rmp`);

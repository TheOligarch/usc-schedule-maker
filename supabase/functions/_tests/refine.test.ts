import { assertEquals } from "jsr:@std/assert@1";
import { RefineRequestSchema, runRefine } from "../_shared/refine.ts";
import { stubModel } from "./helpers.ts";

const req = RefineRequestSchema.parse({
  text: "I'd like at most two classes on Tuesdays and nothing about workload",
  courses: [{ code: "BISC-120", title: "General Biology", sections: [{ id: "13005", type: "LAB", meetings: ["F 8:00 AM - 10:50 AM"], instructors: [] }] }],
  schedule: "BISC-120: LEC TuTh 2pm-3:20pm; LAB F 8am-10:50am",
});

const blank = { days: [], time: null, start: null, end: null, minutes: null, count: null, courses: [], components: [], sectionIds: [], instructors: [] };

Deno.test("model constraints come back in the extension's rule/target shape; invalid ones are dropped", async () => {
  const model = stubModel({
    refine: () => ({
      constraints: [
        { ...blank, kind: "maxPerDay", hard: false, count: 2, days: ["Tue"] },
        { ...blank, kind: "avoidDays", hard: true, days: ["Fri"], courses: ["BISC-120"], components: ["lab"] },
        { ...blank, kind: "notBefore", hard: true, time: "25:00" },
      ],
      unparsed: " workload ",
    }),
  });
  const { body, source } = await runRefine(req, model);
  assertEquals(source, "ai");
  assertEquals(body.constraints, [
    { rule: { kind: "maxPerDay", count: 2, days: ["Tue"] }, hard: false },
    { rule: { kind: "avoidDays", days: ["Fri"] }, hard: true, target: { courses: ["BISC-120"], components: ["lab"] } },
  ]);
  assertEquals(body.unparsed, "workload");
});

Deno.test("a model outage reports the whole text as unparsed instead of guessing", async () => {
  const { body, source } = await runRefine(req, stubModel());
  assertEquals(source, "fallback");
  assertEquals(body, { constraints: [], unparsed: req.text });
});

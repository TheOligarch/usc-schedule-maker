import { assert, assertEquals } from "jsr:@std/assert@1";
import { fallbackExplanation, runExplain } from "../_shared/explain.ts";
import { ExplainRequest, ExplainSchedule } from "../_shared/types.ts";
import { stubModel } from "./helpers.ts";

const schedule = (id: string, penalties: ExplainSchedule["penalties"] = []): ExplainSchedule => ({
  id,
  units: 16,
  score: 90,
  courses: [{ courseCode: "CSCI-201", sectionIds: ["30381"] }],
  penalties,
  warnings: [],
  display: "Mon/Wed 10:00-11:50 CSCI-201; Fridays free",
});

const preferences: ExplainRequest["preferences"] = {
  daySpread: "compact",
  breaks: "avoid",
  maxGapMinutes: 60,
  preferredDaysOff: ["Fri"],
  comfortStart: "10:00",
  comfortEnd: "17:00",
  notes: null,
};

Deno.test("explanations come back one per schedule, in order, with gaps filled", async () => {
  const model = stubModel({
    explain: () => ({
      explanations: [
        { id: "s2", text: "  Second  best. " },
        { id: "unknown", text: "ignored" },
      ],
    }),
  });
  const full = { kind: "full", amount: 40, message: "CSCI-201 lecture 30381 is full." };
  const { body, source } = await runExplain({ preferences, schedules: [schedule("s1", [full]), schedule("s2")] }, model);
  assertEquals(source, "ai");
  assertEquals(body.explanations.map((e) => e.id), ["s1", "s2"]);
  assertEquals(body.explanations[1].text, "Second best.");
  assert(body.explanations[0].text.includes("CSCI-201 lecture 30381 is full"));
  // The model sees rank and penalties, not section ids it could misuse.
  assertEquals(model.calls[0].input.schedules[0].rank, 1);
});

Deno.test("with the model down, every schedule still gets a factual explanation", async () => {
  const { body, source } = await runExplain({ preferences, schedules: [schedule("a"), schedule("b")] }, stubModel());
  assertEquals(source, "fallback");
  assertEquals(body.explanations, [
    { id: "a", text: "Ranked #1 with no penalties against your preferences." },
    { id: "b", text: "Ranked #2 with no penalties against your preferences." },
  ]);
});

Deno.test("no schedules means no model call", async () => {
  const model = stubModel();
  assertEquals((await runExplain({ preferences, schedules: [] }, model)).body, { explanations: [] });
  assertEquals(model.calls.length, 0);
});

Deno.test("fallback explanation leads with the largest deductions", () => {
  const text = fallbackExplanation(
    schedule("x", [
      { kind: "noRmp", amount: 2, message: "No rating for the lecture instructor." },
      { kind: "finalConflict", amount: 50, message: "Two finals overlap." },
      { kind: "full", amount: 30, message: "One section is full." },
    ]),
    3,
  );
  assertEquals(text, "Ranked #3; its largest deductions are: Two finals overlap; One section is full.");
});

Deno.test("explanations never show a 24-hour time, from the model or the fallback", async () => {
  const late = { kind: "preference", amount: 6, message: "Classes end as late as 20:00 (you prefer 17:00 or earlier)." };
  const model = stubModel({ explain: () => ({ explanations: [{ id: "s1", text: "Ranks first, but Monday runs until 20:00." }] }) });
  const { body } = await runExplain({ preferences, schedules: [schedule("s1"), schedule("s2", [late])] }, model);
  assertEquals(body.explanations[0].text, "Ranks first, but Monday runs until 8:00 PM.");
  assertEquals(body.explanations[1].text, "Ranked #2; its largest deductions are: Classes end as late as 8:00 PM (you prefer 5:00 PM or earlier).");
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Requirements } from "../screens/Requirements";
import { Priorities } from "../screens/Priorities";
import { Interview } from "../screens/Interview";
import { defaultState, DEFAULT_PREFERENCES } from "../state";
import { SAMPLE_TERM } from "../mocks/sampleTerm";

const noop = () => {};

describe("setup and interview guidance", () => {
  it("explains slot selection and tuition on Requirements without a rating filter", () => {
    const html = renderToStaticMarkup(<Requirements data={SAMPLE_TERM} state={defaultState()} onChange={noop} onNext={noop} />);
    expect(html).toContain("The interview will ask about your interests and come up with up to five potential courses for each open slot.");
    expect(html).not.toContain("Edit the list, then each schedule chooses one course from it");
    expect(html).toContain("does not audit your degree");
    expect(html).toContain("12–18 units");
    expect(html).toContain("units over 18 generally cost extra");
    expect(html).toContain("Program rules and exceptions may apply");
    expect(html).toContain("Discover-Dornsife-Crafting-Your-Course-Plan.pdf#page=7");
    expect(html).not.toContain("min-rmp");
    expect(html).not.toContain("Minimum professor rating");
    expect(html).not.toContain("Professor ratings");
    expect(html).not.toContain("Set their importance on the next page");
    expect(html).not.toContain('class="limits"');
    expect(html).not.toContain(">Limits<");
    expect(html).toContain('id="unit-cap"');
    expect(html).toContain("No cap");
    expect(html).toContain("When can you take classes?");
    expect(html).not.toContain("Hard rule: every meeting must sit inside one of these blocks.");
  });

  it("offers rating priority and an editable shortlist without repeating setup controls", () => {
    const state = defaultState();
    const priorities = renderToStaticMarkup(<Priorities importance={state.importance} onImportance={noop} onBack={noop} onNext={noop} />);
    expect(priorities).not.toContain("Build schedules around what you actually want.");
    expect(priorities).not.toContain("Your courses, available times and unit cap set the rules.");
    expect(priorities).not.toContain('class="intro"');
    expect(priorities).toContain("Rate each factor from 1 (don&#x27;t care) to 10 (top priority).");
    expect(priorities).toContain("These factors help decide the rankings for your potential schedules");
    expect(priorities).not.toContain("These weights decide how schedules are ranked");
    expect(priorities).toContain('id="imp-rmp"');
    expect(priorities).toContain('id="imp-seatRisk"');
    expect(priorities).toContain('id="imp-finals"');
    expect(priorities).not.toContain('id="imp-daySpread"');
    expect(priorities).not.toContain('id="imp-breaks"');
    expect(priorities).toContain("How important are RateMyProfessor ratings of lecture instructors?");
    state.slots = [{ id: "s", label: "Elective", kind: "elective" }];
    state.interview = { preferences: DEFAULT_PREFERENCES, summary: [], shortlists: [{ label: "Elective", options: [] }] };
    const interview = renderToStaticMarkup(<Interview data={SAMPLE_TERM} sampleData={true} state={state} onChange={noop} onBack={noop} onNext={noop} />);
    expect(interview).toContain("each schedule chooses one from each list");
    expect(interview).toContain("Check your course plan");
    expect(interview).toContain('id="interview-importance-daySpread"');
    expect(interview).toContain('id="interview-importance-breaks"');
    for (const field of ["pref-start", "pref-end", "Preferred days off", "Minimum professor rating"]) expect(interview).not.toContain(field);
    expect(interview).toContain("Edit up to 5 courses per slot");
  });
});

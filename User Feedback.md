# User Feedback

Distinct users: **2**

Keep one numbered record per distinct user. Add follow-up suggestions to that user's record rather than increasing the count.

## 1. Yared Benitez — 2026-11-14

Implementation: [https://github.com/TheOligarch/usc-schedule-maker/pull/11](https://github.com/TheOligarch/usc-schedule-maker/pull/11) (ready for review; not merged).

| Request | Status |
| --- | --- |
| Make RateMyProfessors ratings a soft preference rather than an eligibility requirement, so lower-rated schedules remain candidates. | Implemented: both engines rank by rating priority without a minimum-rating filter. Saved minimums are discarded; missing-rating handling is preserved. |
| Clarify the GE/elective flow on Requirements and Interview: add an open requirement/category, answer interest questions, review up to five real courses per slot, edit those lists, then generate schedules choosing one course from each list. | Implemented: both pages explain the flow and direct students to their course plan; no degree audit or blanket GE-fulfillment guarantee is implied. |
| Add a unit-cap note explaining that standard undergraduate tuition covers 12–18 units and units over 18 generally cost extra, with official USC policy linked. | Implemented beside the unit cap, with the [USC Dornsife courseload policy (page 7)](https://dornsife.usc.edu/advising/wp-content/uploads/sites/96/2026/04/Discover-Dornsife-Crafting-Your-Course-Plan.pdf#page=7). No dollar amount is hardcoded; program rules and exceptions may apply. |
| Remove interview questions that repeat setup information, especially days off, available times, unit cap and professor-rating settings. Keep useful new preference and WRIT-150/GESM interest questions within ten questions. | Implemented: AI planning and guardrails, backend fallback and offline mode ask interests, week layout and gap preferences; no padding to reach ten. Duplicate time/day controls were removed from the interview summary. |

Rollout: backend changes require deploying the `interview` Edge Function. Extension changes require a new build/release; the committed release ZIP is unchanged. Section-topic ranking for WRIT-150/GESM is not implemented.

## 2. Caleb — 2026-11-14

Supplied feedback:

> Verify that discussions and lectures are paired together properly with the right professor. When it comes to sorting classes, the current ranking system will rank schedules that are basically the same, make it so that each schedule is actually distinct from each other, mainly by class times. On the final schedules view (4), let users give text feedback on a schedule and then refresh schedules/rankings instead of having to go back 1-3 like saying "I dont want a bisc lab on friday" on the first page on required courses, add an optional feature for each course to require a specific section i.e his thematic options class each section has a different theme so he would want to choose which one

| Request | Status |
| --- | --- |
| Verify lecture/discussion/lab pairing and professor correctness. | Implemented complete bundles using published link codes and sessions, retaining each component’s own instructors. Reject missing required components and unverifiable all-null multi-lecture associations. Live USC fixtures and a one-field counterfactual reproduce a missing-lab bug; Caleb’s exact observed pairing is unspecified. [Evidence and data limitations](extension/src/__tests__/fixtures/README.md). |
| Offer schedules that differ meaningfully by meeting days/times. | Implemented exact timetable deduplication, best-fit representative selection, and diversity sampling before final score ordering. Fewer distinct feasible timetables produce fewer alternatives. Enumeration and diversity candidate bounds are documented in the engine guide. |
| Enter feedback on a viewed Step 4 schedule and refresh in place. | Implemented local text exclusions, including Caleb’s BISC-Friday-lab example. Existing requirements, pins and preferences persist. Loading, interpretation errors, search retry, no-feasible-alternatives recovery and removing feedback work on Step 4. Supported day/time/component forms are shown in the UI; unsupported text is rejected explicitly. |
| Optionally require a particular section for each course. | Implemented optional per-course section selectors in Step 1 with ID, component, meetings, instructors and available notes/themes. Pins survive interview, save/resume, generation, refinement and ranking; missing/incompatible pins block results and can be cleared. This CORE-112 snapshot has no published per-section themes. |
| Follow-up: ask elective areas of interest, with selectable categories rather than only relation to the major. | Implemented five subject categories with multiple selection and free text, for live-service and offline interviews. Selected categories choose actual catalog candidates and provide relevance scores to schedule ranking. |

Validation: focused pairing, diversity, pin, refinement and elective-interest tests; full extension/engine/scraper checks and release build. Published Spring 2027 data (4,929 courses, 9,320 sections) passes through both live and demo engine seams: the pinned BISC-120 request goes from six combinations to three after Friday-lab feedback; a CORE-112 pin yields exactly its required section. The extracted 11-file ZIP matches the release build byte-for-byte. Release: **0.1.4**, including the rebuilt installable ZIP. No Edge Function source changes or deployment required for these features; live AI still depends on the existing deployed interview/explain services. The isolated browser smoke attempt could not attach to a Chrome target; DOM integration tests exercise the actual generation path instead. No shared WebReg browser, registration or course-bin actions were used.

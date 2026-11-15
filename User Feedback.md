# User Feedback

Distinct users: **1**

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

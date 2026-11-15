`usc-20271-components.json` contains the unmodified course objects for BISC-120,
BISC-220, CORE-112 and CSCI-170 from USC's anonymous public API, retrieved
2026-11-15 UTC (2026-11-14 Pacific):

- https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram?termCode=20271&school=DRNS&program=BISC
- https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram?termCode=20271&school=DRNS&program=CORE
- https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram?termCode=20271&school=ENGV&program=CSCI

The fixture passes through the real scraper normalizer, UI request builder and
async production engine. BISC-220's published lecture notes explicitly require
one lecture, one lab and the quiz. CSCI-170 lists Mate Szabo on lectures and no
instructor on discussions; BISC-220 lab 13148 lists Nancy Castro independently
of lecture instructors. CORE-112 offers individually selectable lecture sections;
this snapshot publishes no per-section theme, so the UI must not invent one.

Reproduction: with one BISC-220 lecture (13011), lab (13140), and quiz (13120),
the original code returns a valid complete combination. Changing only lab
13140's `linkCode` from W to X incorrectly returns lecture+quiz with no lab.
The regression fails before the linkage fix and passes afterward. This is a
proven engine failure on a live-data-shaped counterfactual, not evidence that
USC actually published this inconsistent BISC pairing or that it caused User #2's
unspecified observed professor mismatch.

Trigger: an offered required component has no matching/free code for a lecture.
Symptom: the component disappears from that lecture's bundle. Masking conditions:
complete codes never enter this branch; unrelated time conflicts can eliminate
an invalid bundle before display. The valid-path test widens hours to 11 PM for
CSCI-170's evening quiz; the default 8 PM limit correctly excludes it.

USC's public schema provides section-specific instructors, mode, linkCode and
session, not a universal lecture-to-TA map. We do not compare instructor strings.
All-null multi-lecture/component associations remain unverifiable: the engine
blocks them rather than treating source order as authority. Session and combined
component cases have separate synthetic regression tests. This conservative
policy may exclude valid combinations requiring authenticated WebReg confirmation.
No registration or course-bin operations are part of these tests.

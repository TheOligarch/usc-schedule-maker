# USC Schedule Maker - Chrome extension

Adds a **myScheduleMaker** tab to USC WebReg, immediately to the right of **myCalendar**. Students set hard rules (courses, GE/elective slots, unit cap, allowed class times), answer a short AI interview, and compare schedules ranked by their priorities, including professor ratings. Ratings never exclude a schedule.

## Install (load unpacked)

1. [Download the release ZIP](https://github.com/TheOligarch/usc-schedule-maker/raw/refs/heads/main/extension/release/usc-schedule-maker.zip) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder (the one containing `manifest.json`).
4. Open <https://webreg.usc.edu>, sign in, refresh the page if already open, and click **myScheduleMaker** to the right of **myCalendar**. You can also click the extension's toolbar icon to open the app in its own tab without signing in.
5. Updating? Remove the old card in `chrome://extensions` first (it shows the version). If two copies stay loaded, the newer one takes over the WebReg tab (`src/content/takeover.ts`), but the toolbar icon of each still opens its own copy.

## Develop

Node 20+.

```sh
cd extension
npm ci
cp .env.example .env   # then paste the Supabase anon key (public, but never committed)
npm run dev            # standalone page at http://localhost:5173, no login needed (live engine + AI)
npm run dev:mock       # same page in demo mode (same engine + scripted AI, no key needed)
npm test               # unit tests (vitest)
npm run typecheck
npm run release        # typecheck + build dist/ + write release/usc-schedule-maker.zip
```

`npm run dev`, `npm run build` and `npm run release` all build live (`VITE_USE_MOCKS=false`), so they run the real engine and call the deployed AI functions. They need `VITE_SUPABASE_ANON_KEY` in `.env`; `npm run release` refuses to pack the zip without it. `npm run icons` redraws `public/icons/*.png`.

## How it fits together

| Piece | File |
|---|---|
| WebReg tab + panel (content script) | `src/content/content.ts` |
| Live seat counts from classes.usc.edu, toolbar icon (service worker) | `src/background/background.ts` |
| React app: requirements, priorities, interview, results | `src/App.tsx`, `src/screens/*` |
| Allowed-times drag calendar | `src/components/TimeGrid.tsx` |
| Schedule Builder-style week view | `src/components/WeekCalendar.tsx` |
| Term data download + IndexedDB cache | `src/lib/termData.ts` |
| Shared contract types (copied from the cross-task contract) | `src/lib/contract-types.ts` |
| **Engine seam** (calls `engine/`) | `src/lib/engine.ts` |
| **AI seam** | `src/lib/ai.ts` |

The content script finds WebReg's Bootstrap nav list by its Departments / myCourseBin / Calendar links, adds a tab, and shows the app in an extension-page iframe under the nav, so WebReg's CSS and scripts can't interfere. If no nav is found it shows a floating launcher button instead.

Term data comes from the public `term-data` Supabase bucket (`index.json`, then `<termCode>.json`). It is cached in IndexedDB and refreshed when `scrapedAt` changes. If nothing is published yet, the app uses a bundled sample term (`src/mocks/sampleTerm.ts`, invented instructors and ratings) and labels it "sample data".

## Integration flag

`VITE_USE_MOCKS` is the single switch. It defaults to `false` (live) for `npm run dev` and `npm run build`; demo mode is opt-in with `VITE_USE_MOCKS=true` or `npm run dev:mock`. `npm run release` always builds with `false`. Unit tests use mocks and fixtures directly and do not depend on the flag.

- **Engine**: `false` runs the real engine from `../engine` (`generateSchedulesAsync`, imported from source and bundled into the extension). `true` uses the same engine with demo data, via `src/mocks/mockEngine.ts`.
- **AI**: `false` calls the Supabase Edge Functions `interview` and `explain` with the anon key. `true` uses the scripted interview and explanations in `src/mocks/mockAi.ts`. While the app is on sample term data, the interview stays scripted because the AI shortlists from the real `courses` table. If the AI service is unreachable, the user can switch to the offline interview.

## Data and credits

- Ratings from RateMyProfessors.com. Only the lecture instructor's rating is used. Matches made on first initial + last name are labelled "possible match".
- Seat counts come from the term data file. The top bar and the schedules page show one freshness line ("Live seat counts from classes.usc.edu, updated 3 hours ago"; the Step 1 term picker shows only the term name) from the timestamp of the data in use: the live seat fetch when every course on screen has one, otherwise the term file's `scrapedAt`. Sample data and a missing timestamp get their own truthful wording. Inside the installed extension, the schedule being viewed is refreshed live from classes.usc.edu (at most 6 requests at a time, public course endpoint only).
- "Register" links open the course in WebReg (`/Courses?Program=<DEPT>&Course=<CODE>`) with the schedule's chosen sections for that course outlined and the first one scrolled into view. WebReg keeps the term in the session, so if it is on a different term the page says so and links to WebReg's term switch. The highlight is visual only.
- "Add all to myCourseBin" (Results, per schedule) adds every section of the schedule to the student's WebReg course bin after a confirmation listing them. It works only inside the WebReg tab: the app asks the content script, which loads each course's WebReg page in the signed-in session, takes the section's own "Add to myCourseBin" form (its `data-ajax-url`, `/api/section/<term>/<section>/add`, and its anti-forgery token), and sends the same POST that form sends, with the `X-CSRF: 1` header WebReg's own scripts add to every same-origin request (without it WebReg answers 401 "Missing or invalid X-CSRF header."), one section at a time. As on WebReg's own page, HTTP 200 counts as added and any other status as failed, showing WebReg's message. A section already in the bin is not posted: WebReg's course page replaces its add form with an "Already in Course Bin" label, which the content script reads from the same page and reports as already in the bin (WebReg answers a repeat add with the same empty 200 as a new one, so the answer cannot tell them apart). It refuses when WebReg's session term differs from the schedule's, stops on a session problem, and shows each section as added, already in the bin, or failed with WebReg's message. Every request passes an allowlist (`isAllowedBinRequest` in `src/lib/courseBin.ts`) that admits only a course-page read and that add, so nothing can be registered, dropped, checked out or removed.
- Not affiliated with USC.

## Section choices and schedule refinement

Requirements offers optional section pins for each required course, in a "Require specific
sections (optional)" area that starts collapsed for every course (including after a reload).
A chevron toggle (`aria-expanded`) opens it. While it is collapsed, any active pins are
summarized next to the label and still apply. Inside there is one picker per
component (lecture, lab, discussion, quiz), listing section ID, meetings, instructors and
section notes/themes when USC publishes them. Options come from the engine's own linkage
rules (`src/lib/sectionPins.ts`), so only registrable linked combinations are offered:
choosing a lecture narrows the lab/discussion lists to the ones linked to it, and choosing a
component from another link group replaces the incompatible pin. Students can pin the
lecture, a component, or both. Each pin has its own small "clear section" chip X inside the
picker. The course's unit count and remove button sit together in the card's top-right
corner, which stays fixed as the pickers, chips, tags or notes grow the card. Course codes saved or
typed in another format ("csci 201", a cross-listed alias) are matched to the term's own
code when data loads, and sections listed only under a cross-listed code are included, so
the pickers populate for every course with published sections. Pins survive interview,
saved state (older single-ID pins are migrated) and results refinements; a missing or
unlinked pin blocks generation explicitly and is never relaxed.

Results accepts free-text schedule feedback (`src/lib/refinement.ts`). A local parser turns
common phrasings into structured constraints over meetings, courses, components, sections
and instructors: days off and days to avoid, per-course or per-component days ("CORE 112
only on TTh"), earliest start / latest end (optionally per day), time windows to keep free,
avoiding or requiring instructors, keeping or dropping a particular section ("keep this
lab"), maximum gap, minimum break / no back-to-back, days per week, and classes or hours per
day. "Prefer"/"ideally" makes a constraint soft (it re-ranks instead of excluding). Text the
parser cannot fully account for goes to the `refine` AI function; its answer is validated
against the same shapes and the student's actual courses. Text neither can use is reported
as not understood, and partially used text lists the words that were not used.

The refine box appears only once the current rules produce at least one schedule. When
nothing fits, the page keeps its no-results guidance and lists only feedback already in
effect, so it can be removed. Before anything is applied, the candidate refinement is
dry-run through the real engine
(`src/lib/refineCheck.ts`). If no section combination is left, a warning explains the
conflict (a pinned section, a course whose every combination breaks the rule, or earlier
feedback) and nothing changes: the current schedules, earlier feedback and the typed text
stay as they were. Applied constraints compile to hard section exclusions, soft section
costs and engine whole-week rules, recompiled against newer catalogs. The refine box's
placeholder and suggestion chips are built from the schedule on screen (a real course
component and day, its earliest start, its lightest day). Each inferred suggestion is
dry-run in the background with the same check, against the courses, pins, preferences and
feedback in effect (cached per request), and only those that leave a schedule are shown;
when none do, no chips appear and the placeholder carries no example.

Elective slot questions show five subject categories with multiple selection and free text.
The AI service retains its topic IDs; the client also uses chosen categories against the
loaded catalog's department/title/description to build up to five real elective candidates.
Those relevance scores reach engine ranking. Unselected free-text topics still use the
existing service suggestions. Categories are broad interests, not a degree audit or
prerequisite eligibility check.

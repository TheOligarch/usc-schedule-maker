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
npm run dev:mock       # same page in demo mode (mock engine + scripted AI, no key needed)
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

- **Engine**: `false` runs the real engine from `../engine` (`generateSchedulesAsync`, imported from source and bundled into the extension). `true` uses the stand-in in `src/mocks/mockEngine.ts`.
- **AI**: `false` calls the Supabase Edge Functions `interview` and `explain` with the anon key. `true` uses the scripted interview and explanations in `src/mocks/mockAi.ts`. While the app is on sample term data, the interview stays scripted because the AI shortlists from the real `courses` table. If the AI service is unreachable, the user can switch to the offline interview.

## Data and credits

- Ratings from RateMyProfessors.com. Only the lecture instructor's rating is used. Matches made on first initial + last name are labelled "possible match".
- Seat counts come from the nightly snapshot. Inside the installed extension, the schedule being viewed is refreshed live from classes.usc.edu (at most 6 requests at a time, public course endpoint only).
- "Register" links open the course in WebReg (`/Courses?Program=<DEPT>&Course=<CODE>`) with the schedule's chosen sections for that course outlined and the first one scrolled into view. WebReg keeps the term in the session, so if it is on a different term the page says so and links to WebReg's term switch. The highlight is visual only.
- "Add all to myCourseBin" (Results, per schedule) adds every section of the schedule to the student's WebReg course bin after a confirmation listing them. It works only inside the WebReg tab: the app asks the content script, which loads each course's WebReg page in the signed-in session, takes the section's own "Add to myCourseBin" form (its `data-ajax-url`, `/api/section/<term>/<section>/add`, and its anti-forgery token), and sends the same POST that form sends, one section at a time. It refuses when WebReg's session term differs from the schedule's, stops on a session problem, and shows each section as added, already in the bin, or failed with WebReg's message. Every request passes an allowlist (`isAllowedBinRequest` in `src/lib/courseBin.ts`) that admits only a course-page read and that add, so nothing can be registered, dropped, checked out or removed.
- Not affiliated with USC.

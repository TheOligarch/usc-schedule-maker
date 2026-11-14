# USC Schedule Maker - Chrome extension

Adds a **Schedule Maker** tab to USC WebReg. Students set hard rules (courses, GE/elective slots, unit cap, minimum professor rating, allowed class times), answer a short AI interview, and click through every schedule that fits, ranked by what they actually want.

## Install (load unpacked)

1. Download `release/usc-schedule-maker.zip` from this repo and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder (the one containing `manifest.json`).
4. Open <https://webreg.usc.edu>, sign in, and click the **Schedule Maker** tab in the top navigation. You can also click the toolbar icon to open the app in its own tab without signing in.

## Develop

Node 20+.

```sh
cd extension
npm install
cp .env.example .env   # then paste the Supabase anon key (public, but never committed)
npm run dev            # standalone page at http://localhost:5173, no login needed
npm test               # unit tests (vitest)
npm run typecheck
npm run release        # typecheck + build dist/ + write release/usc-schedule-maker.zip
```

`npm run release` builds with `VITE_USE_MOCKS=false`, so the zip calls the deployed AI functions. It needs `VITE_SUPABASE_ANON_KEY` in `.env`. `npm run icons` redraws `public/icons/*.png`.

## How it fits together

| Piece | File |
|---|---|
| WebReg tab + panel (content script) | `src/content/content.ts` |
| Live seat counts from classes.usc.edu, toolbar icon (service worker) | `src/background/background.ts` |
| React app: priorities, requirements, interview, results | `src/App.tsx`, `src/screens/*` |
| Allowed-times drag calendar | `src/components/TimeGrid.tsx` |
| Schedule Builder-style week view | `src/components/WeekCalendar.tsx` |
| Term data download + IndexedDB cache | `src/lib/termData.ts` |
| Shared contract types (copied from the cross-task contract) | `src/lib/contract-types.ts` |
| **Engine seam** | `src/lib/engine.ts` |
| **AI seam** | `src/lib/ai.ts` |

The content script finds WebReg's Bootstrap nav list by its Departments / myCourseBin / Calendar links, adds a tab, and shows the app in an extension-page iframe under the nav, so WebReg's CSS and scripts can't interfere. If no nav is found it shows a floating launcher button instead.

Term data comes from the public `term-data` Supabase bucket (`index.json`, then `<termCode>.json`). It is cached in IndexedDB and refreshed when `scrapedAt` changes. If nothing is published yet, the app uses a bundled sample term (`src/mocks/sampleTerm.ts`, invented instructors and ratings) and labels it "sample data".

## Integration flag

`VITE_USE_MOCKS` (default `true` for `npm run dev`) is the single switch:

- **AI**: `true` uses the scripted interview and explanations in `src/mocks/mockAi.ts`. `false` calls the Supabase Edge Functions `interview` and `explain` with the anon key. While the app is on sample term data, the interview stays scripted because the AI shortlists from the real `courses` table. If the AI service is unreachable, the user can switch to the offline interview.
- **Engine**: `src/lib/engine.ts` uses the mock engine (`src/mocks/mockEngine.ts`) until the real one is wired in. After `engine/` merges, replace the body of `loadRealEngine()` with:

  ```ts
  return (await import("../../../engine/src/index")).generateSchedules;
  ```

  and build with `VITE_USE_MOCKS=false`. Nothing else imports the mock.

## Data and credits

- Ratings from RateMyProfessors.com. Only the lecture instructor's rating is used. Matches made on first initial + last name are labelled "possible match".
- Seat counts come from the nightly snapshot. Inside the installed extension, the schedule being viewed is refreshed live from classes.usc.edu (at most 6 requests at a time, public course endpoint only).
- "Register" links open the section's page; adding to the course bin is left to WebReg.
- Not affiliated with USC.

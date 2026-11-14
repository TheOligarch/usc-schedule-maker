# USC Schedule Maker

**Build a class schedule around what you actually want.** This Chrome extension adds **myScheduleMaker** to USC WebReg. Choose required courses, leave room for GE or elective options, set your available hours, and compare schedules ranked by your priorities.

Built for the AI@USC hackathon. The initial published catalog is **Spring 2027**.

## Install

You need desktop Google Chrome. The prebuilt ZIP does not require Node.js, a local server, or your own API key.

1. [Download usc-schedule-maker.zip](https://github.com/TheOligarch/usc-schedule-maker/raw/refs/heads/main/extension/release/usc-schedule-maker.zip) and extract it to a folder you will keep on your computer.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the extracted folder directly containing `manifest.json`, rather than the ZIP file.
4. Open <https://webreg.usc.edu>, sign in, and refresh the page if it was already open.
5. Click **myScheduleMaker**, immediately to the right of **myCalendar**.

To open the app without signing into WebReg, open Chrome's Extensions menu and click **USC Schedule Maker**. Pin it for a toolbar shortcut.

To update, download and extract the new ZIP, replace the contents of your installed folder, click **Reload** on its card at `chrome://extensions`, and refresh WebReg.

## Build your schedule

1. **Requirements:** choose your term and required courses, then add flexible GE or elective slots. **Check course plan** opens AdviseUSC for reference.
2. **Priorities:** set your unit cap, professor-rating minimum, available class times, and preference weights. Drag multiple allowed-time blocks to leave gaps; leave a day empty to keep it free.
3. **Interview:** answer a short guided interview with quick replies and optional free text. Review and edit the preference summary and course shortlists.
4. **Results:** compare ranked schedules in a weekly calendar, inspect warnings and explanations, and follow section links to USC's course pages. Results default to the top 10, with up to 100 available.

Registration and adding sections to your course bin happen in WebReg.

## How it works

AI translates the interview into structured preferences, suggests real catalog courses for flexible slots, and explains the top schedules. A deterministic TypeScript engine generates and ranks schedules in your browser, including checking class-time conflicts.

Hard constraints include required courses, allowed meeting times, unit cap, and minimum ratings for rated lecture instructors. Soft penalties rank tradeoffs such as full sections, D-clearance, online or TBA meetings, final-exam conflicts, uncertain section links, and missing ratings. When nothing fits, diagnostics identify constraints whose relaxation would admit more schedules.

| Component | Stack and role |
| --- | --- |
| [Extension](extension/README.md) | React, TypeScript, Vite, Chrome Manifest V3; WebReg tab and standalone extension page |
| [Schedule engine](engine/README.md) | Browser-safe TypeScript; section linkage, conflict checks, scoring, and diagnostics |
| [AI backend](supabase/functions/README.md) | Supabase Edge Functions, Deno, Anthropic Claude; interview, shortlists, and explanations |
| [Course pipeline](scraper/README.md) | Node.js/TypeScript and nightly GitHub Actions; USC catalog, finals, and rating enrichment |
| Storage | Supabase Storage for catalog JSON, Postgres for AI course lookup, IndexedDB for local caching |

The pipeline refreshes terms that have not started yet. Future-term availability depends on USC publishing the catalog and a successful refresh.

## Run locally

Use **Node.js 20 or newer** and npm. Each component has its own package; there is no root-level npm install.

```sh
git clone https://github.com/TheOligarch/usc-schedule-maker.git
cd usc-schedule-maker/extension
npm ci
cp .env.example .env
npm run dev
```

Open the local URL Vite prints. Development defaults to a mock engine and scripted AI, so you can explore the interface without an API key. Catalog loading still attempts the public data service, then cached or sample data.

### Real engine and deployed AI

Set these values in `extension/.env`, then restart Vite:

```dotenv
VITE_SUPABASE_ANON_KEY=<public Supabase anon JWT for the configured project>
VITE_USE_MOCKS=false
```

Obtain the public client key from the project owner or your own Supabase project's API settings. The project URL is in `extension/src/lib/config.ts`; a separate deployment also needs its hosts updated in `extension/public/manifest.json`.

Only the public anon key belongs in the extension. Keep `ANTHROPIC_API_KEY` in Supabase Edge Function secrets and `SUPABASE_SERVICE_ROLE_KEY` in the scraper environment or GitHub Actions secrets. Never put server credentials in `VITE_` variables or commit `.env`.

### Build an installable ZIP

From `extension/`, with the public anon key configured:

```sh
npm run release
```

This type-checks and builds `dist/`, forces `VITE_USE_MOCKS=false`, and writes `release/usc-schedule-maker.zip`. Install the extracted ZIP using the steps above, or select `extension/dist/` directly with **Load unpacked**. A release build needs the public anon key for deployed AI calls to work.

### Checks and backend setup

From `extension/`:

```sh
npm test
npm run typecheck
```

For engine development, run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` in `engine/`. See the [scraper guide](scraper/README.md) for publishing and scheduled-job secrets, and the [AI backend guide](supabase/functions/README.md) for deployment, Deno checks, and changing `AI_MODEL`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Chrome cannot find a manifest | Extract the ZIP and select the folder directly containing `manifest.json`. |
| WebReg tab is missing | Enable the extension and refresh WebReg. Look for a floating Schedule Maker launcher if navigation detection fails, or use the toolbar action. |
| App shows mock mode | Set `VITE_USE_MOCKS=false` and restart Vite, or install the prebuilt release. |
| App shows sample or cached data | Check connectivity and the data-source notice. Sample data has invented instructors and ratings; cached data may be stale. |
| AI interview is unavailable | Check the public anon key for source builds and backend configuration. The UI offers **Use offline interview**; the backend also has a rules-based fallback. |
| No schedules fit | Review the constraint diagnostics and adjust courses, allowed hours, unit cap, or minimum rating. |

## Data, limitations, and credits

- Course data comes from USC's public course API; finals come from the USC registrar. Most seat counts are nightly snapshots; the installed extension attempts live updates for courses in the schedule being viewed.
- Ratings are from **RateMyProfessors.com**, accessed through an unofficial API. Only lecture instructors are matched; initial-based matches are labeled **possible match**, and unresolved ties remain unmatched.
- Prerequisites and restrictions are warnings, without checking completed coursework. Variable-unit courses count their minimum units toward the cap.
- Ambiguous section linkage receives a warning and penalty. TBA meetings have no known times to check. Finals may be unavailable; review section details before registering.
- Dense searches have an enumeration limit; see the [engine guide](engine/README.md) for truncation and scoring details.
- This independent student project is unaffiliated with USC or RateMyProfessors.

## Future work

- Backup classes that fit the chosen schedule if a section fills.
- Import the student's advised USC course plan.
- One-click **add to course bin** in WebReg.
- Seat-count history to show how quickly sections fill.
- Room locations from authenticated WebReg pages.
- Pre-2015 GE categories.
- Tune the interview length, currently capped at 10 questions.
- Prerequisite checking against completed courses.

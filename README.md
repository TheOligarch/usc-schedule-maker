# USC Schedule Maker

**Build a class schedule around what you actually want.** This Chrome extension adds **myScheduleMaker** to USC WebReg. Choose required courses, leave room for GE or elective options, set your available hours, and compare schedules ranked by your priorities.

Built for the AI@USC hackathon. The initial published catalog is **Spring 2027**.

## Install

To install, all you need is desktop Google Chrome.

1. [Download usc-schedule-maker.zip](https://github.com/TheOligarch/usc-schedule-maker/raw/refs/heads/main/extension/release/usc-schedule-maker.zip) and extract it to a folder you will keep on your computer.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the extracted folder directly containing `manifest.json`, rather than the ZIP file.
4. Open <https://webreg.usc.edu>, sign in, and refresh the page if it was already open.
5. Click **myScheduleMaker**, immediately to the right of **myCalendar**.

Updating from an older download? Chrome keeps running whatever folder it loaded, so a new ZIP changes nothing until you **Remove** the old USC Schedule Maker card in `chrome://extensions` (or click its reload icon after replacing that folder's contents). The card shows the version; the current release is 0.1.2.

To open the app without signing into WebReg, open Chrome's Extensions menu and click **USC Schedule Maker**. Pin it for a toolbar shortcut.

## Build your schedule

1. **Requirements:** choose your term and required courses, add open GE categories or elective slots, and set your unit cap and available class times. Leave a day empty to keep it free. **Check course plan** opens AdviseUSC for reference.
2. **Priorities:** set how much professor ratings, seat availability, and final-exam conflicts should influence ranking. Lower-rated and unrated instructors remain candidates.
3. **Interview:** answer a few questions about your interests and week layout. Set the importance of week layout and breaks beside the matching questions, or edit those weights with your preferences in the summary. Review and edit the summary and up to five real courses per open slot; each generated schedule chooses one course per slot. The app does not audit your degree requirements.
4. **Results:** compare ranked schedules in a weekly calendar, inspect warnings and explanations, and follow section links to USC's course pages. Results default to the top 10, with up to 100 available.

Signed in to WebReg, open Schedule Maker from its myScheduleMaker tab and use **Add all to myCourseBin** on a schedule to put every one of its sections (lectures, labs, discussions, quizzes) in your course bin in one step, after confirming the list. It only adds to the bin; registration still happens in WebReg.

## How it works

AI translates the interview into structured preferences, suggests real catalog courses for flexible slots, and explains the top schedules. A deterministic TypeScript engine generates and ranks schedules in your browser, including checking class-time conflicts.

Hard constraints include required courses, allowed meeting times, and unit cap. Professor ratings are a soft ranking preference, with a small penalty for missing ratings. Soft penalties rank tradeoffs such as full sections, D-clearance, online or TBA meetings, final-exam conflicts, uncertain section links, and missing ratings. When nothing fits, diagnostics identify constraints whose relaxation would admit more schedules.

| Component | Stack and role |
| --- | --- |
| [Extension](extension/README.md) | React, TypeScript, Vite, Chrome Manifest V3; WebReg tab and standalone extension page |
| [Schedule engine](engine/README.md) | Browser-safe TypeScript; section linkage, conflict checks, scoring, and diagnostics |
| [AI backend](supabase/functions/README.md) | Supabase Edge Functions, Deno, Anthropic Claude; interview, shortlists, and explanations |
| [Course pipeline](scraper/README.md) | Node.js/TypeScript and nightly GitHub Actions; USC catalog, finals, and rating enrichment |
| Storage | Supabase Storage for catalog JSON, Postgres for AI course lookup, IndexedDB for local caching |

The pipeline refreshes terms that have not started yet. Future-term availability depends on USC publishing the catalog and a successful refresh.

## Data, limitations, and credits

- Course data comes from USC's public course API; finals come from the USC registrar. Most seat counts are nightly snapshots; the installed extension attempts live updates for courses in the schedule being viewed.
- Ratings are from **RateMyProfessors.com**, accessed through an unofficial API. Only lecture instructors are matched; initial-based matches are labeled **possible match**, and unresolved ties remain unmatched.
- Prerequisites and restrictions are warnings, without checking completed coursework. Variable-unit courses count their minimum units toward the cap.
- Ambiguous section linkage receives a warning and penalty. TBA meetings have no known times to check. Finals may be unavailable; review section details before registering.
- Dense searches have an enumeration limit; see the [engine guide](engine/README.md) for truncation and scoring details.
- This independent student project is unaffiliated with USC or RateMyProfessors.

See [User Feedback](<User Feedback.md>) for the running feedback log and implementation status.

## Future work
- Backup classes that fit the chosen schedule if a section fills.
- Import the student's advised USC course plan.
- Seat-count history to show how quickly sections fill.
- Room locations from authenticated WebReg pages.
- Pre-2015 GE categories.
- Tune the interview length, currently capped at 10 questions.
- Prerequisite checking against completed courses.

# scraper

Nightly data pipeline for USC Schedule Maker. It scrapes the public `classes.usc.edu` JSON API, the
registrar's final-exam page and a once-per-semester RateMyProfessors snapshot, then normalizes everything into the
`TermData` file from the shared contract (section 1) and publishes it to Supabase.

| Output | Where | Read by |
|---|---|---|
| `term-data/<termCode>.json` (`TermData`) | public Storage bucket, `https://mmdvgvpckweiklkbuxvy.supabase.co/storage/v1/object/public/term-data/20271.json` | engine, extension |
| `term-data/index.json` (`{ terms: [...] }`) | same bucket | extension |
| `public.courses` rows (anon `select`) | Postgres | AI functions |
| `scraper-cache/rmp/<termCode>.json` | private bucket | scraper only (RMP snapshot reuse) |

A small real-data sample lives in `fixtures/sample-term.json`. It includes a coded-linkage course (CSCI-201), an
ambiguous one (PHYS-151), a cross-listed pair (AMST-250 / ENGL-250), a TBA course, an online course, a D-clearance
course, a QREA GE course and a course with a full section.

## Run

```sh
cd scraper
npm ci
npm test
npm run scrape -- --dry-run            # scrape + validate, write out/<term>.json, publish nothing
npm run scrape                         # publish (needs SUPABASE_SERVICE_ROLE_KEY)
npm run scrape -- --terms 20271        # force terms instead of auto-detecting them
npm run fixture -- out/20271.json fixtures/sample-term.json
```

Credentials come from the environment, or from a gitignored `scraper/.env` file:

```
SUPABASE_URL=https://mmdvgvpckweiklkbuxvy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

In CI, `.github/workflows/scrape.yml` runs every night at 10:17 UTC and can also be started by hand. It uses the
repo secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Pipeline

1. **Terms.** The scraper reads `/api/Terms/Active` and keeps only the terms that **have not started yet**. The start
   date is the "Standard session 001 dates" line on the finals page. If the page doesn't list the term, it falls back
   to an estimate per season (Spring Jan 8, Summer May 12, Fall Aug 18). Once a term has started, it stops being
   refreshed, but its last file stays published.
2. **Courses.** It reads `/api/Schools/TermCode`, then `/api/Courses/CoursesByTermSchoolProgram` for every
   (school, program) pair. It also reads `/api/Ge/TermCode` and `/api/Courses/GeCoursesByTerm` for the
   **current GE system only** (`Fall2015OrLater`). Requests are polite:
   - at most 6 in flight;
   - up to 4 retries with exponential backoff on 5xx, 429 and network errors;
   - a User-Agent that names this repo.

   The HTTP layer refuses to call the admin routes (`Configuration/*`, `Users/*`, `BackgroundJob/*`).
3. **Normalize** (`src/normalize.ts`):
   - **Course codes.** Each course is keyed by the code it is *listed* under (`matchedCourseCode`). A cross-listed
     course comes back once per program with the same sections. For example, AMST-250 and ENGL-250 both exist and
     share `Section` objects. `Section.courseCodes` lists every code, and `Course.crossListedWith` lists the others.
   - **Sections.** They are deduped by `sisSectionId`, and cancelled sections are dropped.
   - **Meetings.** Days come from `days[]`. `dayCode` is never used because it is ambiguous (`TH` means Tue+Thu).
     TBA meetings are dropped, so `meetings: []` means TBA.
   - **Units.** Each unit range is `{min, max}`. Variable-unit courses (1–12) count `min` toward the cap, which the
     engine enforces.
   - **Linkage** (contract section 4):
     - `coded`: any section has a linkCode.
     - `single`: all codes are null and there is at most one lecture, or only one component type.
     - `ambiguous`: all codes are null and there are several lectures plus other components. Spring 2027 has 17,
       including PHYS-151/152/153, CHEM-322B and CORE-101/104.
   - **Prerequisites.** `prereqText` covers prerequisites, corequisites, concurrent enrollment, recommended
     preparation, and class-standing, major and school restrictions, plus duplicate credit. It is a warning only.
4. **Campus.** No section in the public payload carries a campus field. We checked all 9.3k Spring 2027 sections
   on 2026-11-14. The site's JS bundle knows `campusCode`, but the API never sends it. So `campus` is always `null`
   and the engine should skip the campus penalty. The code fills it automatically if `campusCode` ever starts
   arriving.
5. **Online** (best inference, `inferOnline`). The payload has no modality field, and session codes don't map to
   delivery mode. For example, Viterbi session 048 includes sections noted "In-person attendance required". So the
   scraper reads each section's own name, description and notes, one sentence at a time:
   - It skips URLs, and sentences about a *different* section number.
   - A section is **online** when a sentence says the section or course is online, names an online program or
     cohort ("Online MBA program", "MAT online only", "EDL Online"), meets on or via Zoom, is asynchronous, or is a
     DEN@Viterbi section.
   - "hybrid", "in-person" or "on campus" anywhere in the text forces **not online**.
   - TBA sections are not marked online, because the engine already treats empty meetings as TBA.

   In Spring 2027, 113 sections are marked online.
6. **Finals** (`src/finals.ts`). The scraper parses the term's chapter of https://arr.usc.edu/final-exam-schedule/:
   - **Pattern table.** Rows map a start time and MWF/TTh pattern to an exam slot. Rows with a time range such as
     "10:00 – 10:50" must match the class's end time too.
   - **4–6 PM and once-weekly evening rules.** These use the first class meeting inside the exam window.
   - **Saturday rows.**
   - **Common-final table.** It maps program names to prefixes, such as "German" to German Studies (GERM).

   Only lecture-type sections in session 001 with set meeting times get a `final`. Times outside the regular
   periods get `null` instead of a guess. If the term's chapter is missing or its table format is not recognized,
   every final is `null` and the run logs a `::warning::`. The run does not fail.
7. **RMP** (`src/rmp.ts`). One snapshot is taken per semester through the unofficial GraphQL API (school
   `U2Nob29sLTEzODE=`). It is cached in `.cache/` and in the private `scraper-cache` bucket, and later runs reuse
   it. Only **lecture** instructors are matched:
   1. Normalized exact first + last name gives `rmpMatch: "exact"`.
   2. Otherwise, a unique first initial + last name gives `"initial"`, which the UI labels "possible match".
   3. Duplicates at either step are broken by department, using the program name of the section's course prefix.
   4. Anything still tied stays unmatched, never guessed.

   Teachers with 0 ratings count as unrated. Spring 2027 results: 3,702 exact, 382 initial, and 2,565 unmatched
   lecture-instructor slots. The UI must show `RMP_CREDIT` ("Ratings from RateMyProfessors.com") wherever ratings
   appear.
8. **Validate and publish.** Each term must have at least 200 courses and 1,000 sections, and at least 60% of the
   section count last published. Every reference must resolve. Only then is the term published, in this order:
   1. Upload `<code>.json`.
   2. Swap that term's `courses` rows atomically through `replace_term_courses`, which deletes and inserts in one
      transaction.
   3. Rewrite `index.json` last.

   If anything fails, that term is not published, the previous data stays, and the process exits non-zero. A failed
   Actions run then emails the repo owner. Objects are uploaded with `Cache-Control: max-age=300`.

## Numbers (Spring 2027, 2026-11-14)

The term has 244 programs, 4,929 courses and 9,320 sections, after 41 cancelled sections were dropped. 2,158
sections are TBA and 3,789 sections have finals. The published JSON is about 6.6 MB, and a full run takes about 4
minutes.

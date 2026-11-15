# AI functions (Supabase Edge Functions)

Three Deno functions on project `mmdvgvpckweiklkbuxvy`, called by the extension with the anon key (`Authorization: Bearer <anon>` and `apikey: <anon>`). Base
URL: `https://mmdvgvpckweiklkbuxvy.supabase.co/functions/v1/`. CORS is open.

| Function    | Method | Does                                                                                                        |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `ai-health` | GET    | `{ keyPresent, model, modelOk }` after one tiny model call (`error` added only when `modelOk` is false)     |
| `interview` | POST   | One stateless turn of the guided interview (at most 10 questions), then preferences, shortlists and summary |
| `explain`   | POST   | 1-2 sentence "why this ranks here" for each of the top <= 10 schedules                                      |

Request and response shapes are in `_shared/types.ts` and follow section 5 of the shared build contract. `interview` also accepts an optional
`hardHours: { earliestStart, latestEnd }` (24h `HH:MM`) so any times it mentions stay inside the student's hard window; it never asks about start or end times
and always returns null comfort hours. Days off, available times, unit cap and professor-rating settings are not asked again; the model question is rejected if
it drifts into these settings. Every response carries an `x-usm-ai-source: ai | fallback` header: when the model is unavailable, the functions still answer from
built-in questions and rules instead of failing.

## Changing the model

The model is read in one place (`_shared/model.ts`). Set the `AI_MODEL` function secret in the Supabase dashboard (Edge Functions > Secrets) to any Claude model
ID. If it is unset, the functions use `claude-haiku-5-5`. Call `ai-health` afterwards to confirm `modelOk: true`. An optional `AI_EFFORT` secret (`low`..`max`,
or `off` for models that reject the effort parameter) overrides the per-call effort. `ANTHROPIC_API_KEY` is never logged or returned.

## Course shortlists

`interview` reads the `courses` table (owned by `scraper/` and `supabase/migrations/`) with the anon key. GE slots are filtered by `geCategory`; elective slots
are searched by interest in title and description. The model may only pick codes from those candidates. If the table is empty or missing for the term, the
shortlists come back empty with a note in `summary`, never invented codes.

## Course-aware interests

Required WRIT-150 adds a writing-interest question; GESM course codes (including suffixed variants such as GESM-120g) add a seminar-topic question. GE slots
identified as GESM or General Education Seminar share the seminar question instead of receiving a duplicate generic interest question. Both topics fit inside
the ten-question budget, alongside the existing GE/elective questions. The extension's offline interview uses the same course-interest definitions.

Answers appear in the editable summary and preference notes in both AI and fallback modes. Seminar-slot answers also feed the existing course shortlist
selection. Required-course interests are retained as context; individual WRIT-150/GESM sections are not ranked by topic. Backend changes require deploying the
`interview` function; bundled offline changes require a new extension build.

The interview asks only about interests, day spread and gaps between classes. It finishes when these topics are covered, without padding to ten questions.

## Checks

From this folder, with Deno 2:

```sh
deno task check   # type-check everything
deno task test    # unit tests with a stubbed model and catalog (no network, no key)
deno task lint    # deno lint + deno fmt --check
USM_ANON_KEY=<anon key> deno task smoke   # exercises the deployed functions end to end
```

## Deploying

Deploy each function with its entrypoint plus the `_shared/` files it imports (the Supabase CLI does this with `supabase functions deploy <name>`). Keep JWT
verification on: the extension sends the anon JWT.

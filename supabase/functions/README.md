# AI functions (Supabase Edge Functions)

Four Deno functions on project `mmdvgvpckweiklkbuxvy`, called by the extension with the anon key (`Authorization: Bearer <anon>` and `apikey: <anon>`) and an
anonymous install ID (`x-usm-install-id`, see Rate limits). Base URL: `https://mmdvgvpckweiklkbuxvy.supabase.co/functions/v1/`. CORS is open.

| Function    | Method | Does                                                                                                        |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `ai-health` | GET    | `{ keyPresent, model, modelOk }` after one tiny model call (`error` added only when `modelOk` is false)     |
| `interview` | POST   | One stateless turn of the guided interview (at most 10 questions), then preferences, shortlists and summary |
| `explain`   | POST   | 1-2 sentence "why this ranks here" for each of the top <= 10 schedules                                      |
| `refine`    | POST   | One piece of results-page schedule feedback -> `{ constraints, unparsed }` (structured, validated again)    |

`refine` only translates text the extension's local parser could not fully account for. It never guesses on a model failure: the `fallback` answer returns no
constraints and the whole text as `unparsed`, which the extension reports as not understood. If the function is unreachable (for example HTTP 404 before a
deploy), the extension degrades the same way. Deployed 2026-11-15 (version 1, JWT verification on, same project secrets as `interview`/`explain`).

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

## Rate limits

Every model call the functions make is charged to a budget first (`_shared/rate-limit.ts`). A call over budget is never made: the request gets HTTP 429.
Schedule generation and ranking run in the extension and never touch these functions, so only the AI features pause.

**Weighting.** Budgets count units, not HTTP requests, because one small request can make the interview build a very large prompt (12 GE slots with 150
candidates each is a ~525,000-character final prompt from a ~1 KB request). Each model call costs `ceil((system prompt + user message characters) / 4000)`
units, at least 1, so one unit is about 1,000 prompt tokens. An `ai-health` ping costs 1. The charge happens just before the call, and a call that would go over
budget is not charged. Measured costs per call: interview question 1-2 units (up to 6 with a long typed history), interview search 1, interview final about 12
per shortlisted GE slot, explain about 2, refine about 3.

**Buckets.** Each call is charged to all of these together, or to none of them if any would go over (one atomic `ai_rate_limit_take` call):

| Scope     | Keyed by                     | Window              | Default budget (units)                                                      |
| --------- | ---------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `user`    | install ID, per function     | clock hour, UTC day | interview 600 / 1800, explain 150 / 450, refine 250 / 750, ai-health 6 / 20 |
| `network` | salted IP hash, per function | clock hour, UTC day | the `user` budget x 30, so many students behind one campus NAT fit          |
| `global`  | everything                   | UTC day             | 100,000 (about 100M prompt tokens, about 2,000 typical sessions)            |

The per-user numbers come from one planning session: an interview is about 5-10 question calls, one search call and one final call (60 units covers several GE
slots and a rewind), explain runs about 6 times as the top 10 changes (15 units), refine about 6 times for feedback the local parser cannot read (25 units). The
budgets fit about 10 sessions per hour and 30 per day. A request with no valid install ID (an old build or a script) uses its hashed IP as the user key. The
global ceiling is the breaker below the Anthropic account cap: set it to about (daily spend you accept) / (cost of 1,000 prompt tokens).

**429 response.** `Retry-After: <seconds>` and
`{ error: { code: "rate_limited", message, details: { scope: "user" | "network" | "global", retryAfterSeconds } } }`. `retryAfterSeconds` runs until the
exceeded window ends (the latest one if several are exceeded). The extension shows its own wait message from `_shared/rate-limit-message.ts`, keyed by `scope`,
and stops calling that function (or all of them, for `global`) until the wait is over.

**Configuration** (function secrets, read on every request, so no extension release or redeploy is needed):

| Secret                                        | Default                                      | Meaning                                                                   |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `RATE_LIMIT_<FN>_HOUR`, `RATE_LIMIT_<FN>_DAY` | see the table above                          | Per-user units; `<FN>` is `INTERVIEW`, `EXPLAIN`, `REFINE` or `AI_HEALTH` |
| `RATE_LIMIT_IP_MULTIPLIER`                    | `30`                                         | Network budget = user budget x this                                       |
| `RATE_LIMIT_GLOBAL_DAY`                       | `100000`                                     | Units per UTC day for everyone together                                   |
| `RATE_LIMIT_IP_SALT`                          | unset                                        | Secret salt for IP hashes; without it there are no `network` buckets      |
| `RATE_LIMIT_IP_HEADER`                        | `cf-connecting-ip,x-real-ip,x-forwarded-for` | Headers to read the client IP from, first match wins                      |
| `RATE_LIMIT_ENABLED`                          | on                                           | `false` turns the limiter off                                             |

An invalid number is ignored (logged) and the default applies. If the counter store fails (no `SUPABASE_SERVICE_ROLE_KEY`, network error, RPC error, a timeout
over 3 seconds), the call goes through and the failure is logged: a limiter outage never blocks students.

**Privacy.** These rules are exact, and the privacy policy is written from them:

- Raw IP addresses are never stored. The functions store only an HMAC-SHA-256 of the client IP, keyed with the `RATE_LIMIT_IP_SALT` secret and truncated to 128
  bits.
- The install ID is a random UUID the extension generates once per install and keeps in `chrome.storage.local`. It is sent only in the `x-usm-install-id` header
  and is not linked to any account, name, email, WebReg data or other identity.
- Counter rows hold only the bucket key (scope, function, install ID or IP hash), the window start and end, and a count. Each row is deleted once its window
  ends (at most 24 hours after it starts), on the next write and by an hourly `pg_cron` job, which also removes anything older than 48 hours. No row is kept
  longer than 48 hours.
- The counter table has row-level security on, no policies and no privileges for `anon` or `authenticated`. Only the service role can read or write it, through
  `ai_rate_limit_take`, which is executable by `service_role` only.

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
verification on: the extension sends the anon JWT. Rate limiting needs the `create_ai_rate_limits` migration applied first and the `RATE_LIMIT_IP_SALT` secret
set (a long random string, for example from `openssl rand -hex 32`). The functions use the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` that Supabase provides
to every function.

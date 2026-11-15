# engine

Dependency-free, browser-safe TypeScript library that builds every schedule
satisfying a student's hard constraints and ranks them by soft-preference fit
(shared build contract, section 3).

```ts
import { generateSchedules, generateSchedulesAsync } from "../engine/src/index";

const result = generateSchedules(termData, request, { limit: 10 });
// or, to keep the UI responsive:
const result2 = await generateSchedulesAsync(termData, request, { limit: 10, signal });
```

`result.schedules` is best-first (length <= limit, default 10, max 100);
`result.totalValid` counts every valid section combination; `result.totalDistinct` counts unique meeting timetables among the enumerated combinations; `result.blockers` explains
what is keeping schedules out (always filled when `totalValid === 0`).

The sources use extensionless relative imports, so consume `src/` through a
bundler (Vite, esbuild, ...) or the `dist/` output of `npm run build`.

## Rules

- **Linkage**: use USC's `linkCode` and `session`, preserving each section's own instructor list.
  Each bundle contains one lecture and every offered component type, with combined
  lecture/lab or lecture/discussion sections satisfying their own component. Null
  codes are unrestricted within a session but cannot mix two non-null codes.
  All-null, multi-lecture/component data is unverifiable and blocked; section order
  and matching instructor names do not establish an association. This conservative
  policy can exclude registrable combinations USC's public data cannot prove.
- **Cross-listing**: a requested code is satisfied by any section listed
  under it. Two required codes for the same class share one section (units
  counted once); a flex slot can never be filled by a class already chosen.
- **Hard constraints**: every meeting inside one of that day's allowed blocks
  (`[]` = day off; TBA meetings never violate), no overlaps (including within a
  course's own sections), and `unitCap` on `units.min`. Exactly one course per flex slot.
  `sectionPins` maps each required course to a mandatory section ID. Invalid pins
  block results; `excludedSectionIds` from feedback are hard exclusions. Neither is
  relaxed by diagnostics or to fill a result limit.
  Professor ratings never exclude a schedule; legacy `minRmp` requests are accepted but ignored.
  An instructor with fewer than `rmpMinRatings` ratings, no RMP match, or a lecture with no
  instructor counts as unrated: a small `noRmp` penalty, never excluded.
- **Soft scoring**: every weight is in `src/weights.ts` (one documented table)
  and is multiplied by `importance[key] / 5` for its importance knob. Heavy:
  full, waitlist, D-clearance, online/TBA/HSC, final-exam conflict. Small: no RMP rating, plus a per-point RMP quality tie-breaker.
  Preference fit: day spread, gaps / back-to-back classes, `maxGapMinutes`,
  preferred days off, comfort start/end, and `courseInterestScores` (0..1 relevance
  for shortlisted electives; up to 8 penalty points for weaker interest matches). `score = 100 * S / (S + totalPenalty)`.
  Pass `opts.weights` to override any weight per call.
- **Blockers**: each single constraint (earlier start, later end, gaps between
  blocks, each day off, a course whose every section is outside your times,
  unit cap, time conflicts) is relaxed alone and the number of
  extra schedules it admits is reported, most first. When nothing fits and no
  relaxation helps, it suggests dropping a course; when even that fails it
  says several constraints must change.

## Performance

Requirements are searched fewest-options-first with iterative backtracking;
pairwise compatibility (time overlap / same class) is precomputed into
matrices, units are pruned against the cap with a lower bound for the
remaining courses. Equivalent exact meeting timetables keep their lowest-cost
representative, regardless of section IDs or course labels. From the best 2,000
unique candidates (or `limit * 20`), selection keeps the best fit, then greedily
balances half-hour occupancy distance (65%) and relative fit (35%), before sorting
selected alternatives by score. Nearby starts have less diversity than changed
days; fewer distinct timetables produce fewer results. Limits can change which
alternatives are selected, while the best fit stays first.

Enumeration stops at `maxEnumerate` (default 100,000; `truncated: true`); counts
and diversity are limited to enumerated leaves. Blocker counts stop at 20,000.
The synthetic full-size-term benchmark (about 10,000 sections, five required
courses plus an elective slot, 20,439 valid combinations) runs under the existing
2-second test budget; async generation yields to the event loop.

## Contract compatibility

- `minRmp` is optional and ignored. Use `importance.rmp` to scale the soft rating and missing-rating penalties.
- `GenerateResult.truncated?: boolean`.
- `generateSchedules` / `generateSchedulesAsync` accept extra options:
  `maxEnumerate`, `weights`, `diagnostics`; the async variant also takes
  `signal` and `sliceMs`.
- Extra blocker `constraint` values: `unknownCourse`, `requiredCourse`,
  `flexSlot`, `combination`, `sectionPin`.

## Scripts

```sh
npm install
npm test          # vitest (unit + performance)
npm run typecheck
npm run build     # emits dist/
```

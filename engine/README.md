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
`result.totalValid` counts every valid schedule; `result.blockers` explains
what is keeping schedules out (always filled when `totalValid === 0`).

The sources use extensionless relative imports, so consume `src/` through a
bundler (Vite, esbuild, ...) or the `dist/` output of `npm run build`.

## Rules

- **Linkage** (contract section 4): same non-null `linkCode` across types is
  taken together; a null-coded type is "any one section of that type". An
  `ambiguous` course pairs each lecture with the following non-lecture
  sections (a lecture with none of a type may take any of that type) and gets
  the `ambiguousLink` penalty plus a warning.
- **Cross-listing**: a requested code is satisfied by any section listed
  under it. Two required codes for the same class share one section (units
  counted once); a flex slot can never be filled by a class already chosen.
- **Hard constraints**: every meeting inside one of that day's allowed blocks
  (`[]` = day off; TBA meetings never violate), no overlaps (including within a
  course's own sections), and `unitCap` on `units.min`. Exactly one course per flex slot.
  Professor ratings never exclude a schedule; legacy `minRmp` requests are accepted but ignored.
  An instructor with fewer than `rmpMinRatings` ratings, no RMP match, or a lecture with no
  instructor counts as unrated: a small `noRmp` penalty, never excluded.
- **Soft scoring**: every weight is in `src/weights.ts` (one documented table)
  and is multiplied by `importance[key] / 5` for its importance knob. Heavy:
  full, waitlist, D-clearance, online/TBA/HSC, final-exam conflict, ambiguous
  link. Small: no RMP rating, plus a per-point RMP quality tie-breaker.
  Preference fit: day spread, gaps / back-to-back classes, `maxGapMinutes`,
  preferred days off, comfort start/end. `score = 100 * S / (S + totalPenalty)`.
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
remaining courses, and the best `limit` schedules are kept in a bounded heap.
Enumeration stops at `maxEnumerate` (default 100,000; `truncated: true`), and
blocker counts stop at 20,000 (shown as "N+"). On a synthetic full-size term
(~10,000 sections, 5 courses x 36 combos + a 5-option slot) a request takes
~0.2s in Node; a dense request that hits the 100k cap stays under ~1s.

## Contract compatibility

- `minRmp` is optional and ignored. Use `importance.rmp` to scale the soft rating and missing-rating penalties.
- `GenerateResult.truncated?: boolean`.
- `generateSchedules` / `generateSchedulesAsync` accept extra options:
  `maxEnumerate`, `weights`, `diagnostics`; the async variant also takes
  `signal` and `sliceMs`.
- Extra blocker `constraint` values: `unknownCourse`, `requiredCourse`,
  `flexSlot`, `combination`.

## Scripts

```sh
npm install
npm test          # vitest (unit + performance)
npm run typecheck
npm run build     # emits dist/
```

import type { Block, Day, TermData, RankedSchedule } from "../lib/contract-types";
import { placedMeetings, scheduleSections, SECTION_TYPE_LABEL, type PlacedMeeting } from "../lib/schedule";
import { DAYS, DAY_LONG, WEEKDAYS, fmtTime, toMin } from "../lib/time";

const PX_PER_HOUR = 46;
const PX_PER_MIN = PX_PER_HOUR / 60;

/** Stable colour index per course within one schedule. */
export function courseColors(sched: RankedSchedule): Map<string, number> {
  const map = new Map<string, number>();
  sched.courses.forEach((c, i) => map.set(c.courseCode, i % 8));
  return map;
}

interface Props {
  data: TermData;
  schedule: RankedSchedule;
  allowed: Record<Day, Block[]>;
  highlight?: string | null;
  onHighlight?: (courseCode: string | null) => void;
}

/** Schedule Builder-style week view of one schedule. Disallowed hours are hatched. */
export function WeekCalendar({ data, schedule, allowed, highlight, onHighlight }: Props) {
  const placed = placedMeetings(data, schedule);
  const colors = courseColors(schedule);
  const days = DAYS.filter((d) => WEEKDAYS.includes(d) || placed.some((p) => p.day === d));
  const earliest = Math.min(8 * 60, ...placed.map((p) => p.start));
  const latest = Math.max(18 * 60, ...placed.map((p) => p.end));
  const start = Math.floor(earliest / 60) * 60;
  const end = Math.ceil(latest / 60) * 60;
  const height = (end - start) * PX_PER_MIN;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const unplaced = scheduleSections(data, schedule).filter((x) => x.section.meetings.length === 0);

  return (
    <div className="weekcal-wrap">
      <div className="weekcal" style={{ ["--cols" as string]: days.length }}>
        <div className="wc-head wc-corner" aria-hidden="true" />
        {days.map((d) => (
          <div key={d} className="wc-head">
            <abbr title={DAY_LONG[d]}>{d}</abbr>
          </div>
        ))}
        <div className="wc-hours" aria-hidden="true" style={{ height }}>
          {hours.map((h) => (
            <span key={h} style={{ top: (h - start) * PX_PER_MIN }}>
              {fmtTime(h, true)}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="wc-col" style={{ height }} role="list" aria-label={DAY_LONG[d]}>
            {hours.slice(1, -1).map((h) => (
              <span key={h} className="wc-line" style={{ top: (h - start) * PX_PER_MIN }} />
            ))}
            <Unavailable blocks={allowed[d] ?? []} start={start} end={end} />
            {layoutDay(placed.filter((p) => p.day === d)).map(({ p, lane, lanes }) => {
              const sec = data.sections[p.sectionId];
              const color = colors.get(p.courseCode) ?? 0;
              const dim = highlight && highlight !== p.courseCode;
              return (
                <div
                  key={`${p.sectionId}-${p.start}`}
                  role="listitem"
                  className={`wc-event c${color} ${dim ? "dim" : ""} ${highlight === p.courseCode ? "lit" : ""}`}
                  style={{ top: (p.start - start) * PX_PER_MIN, height: Math.max(22, (p.end - p.start) * PX_PER_MIN - 2), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  onMouseEnter={() => onHighlight?.(p.courseCode)}
                  onMouseLeave={() => onHighlight?.(null)}
                  aria-label={`${p.courseCode} ${SECTION_TYPE_LABEL[p.type]}, ${DAY_LONG[d]} ${fmtTime(p.start)} to ${fmtTime(p.end)}`}
                >
                  <span className="wc-code">{p.courseCode}</span>
                  <span className="wc-meta">
                    {p.type} · {fmtTime(p.start, true)}-{fmtTime(p.end, true)}
                  </span>
                  {sec && p.end - p.start >= 70 && <span className="wc-meta">{sec.instructors[0] ? sec.instructors[0].last : "TBA"}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {unplaced.length > 0 && (
        <p className="wc-unplaced small">
          <strong>Not on the calendar:</strong>{" "}
          {unplaced.map(({ courseCode, section }, i) => (
            <span key={section.id}>
              {i > 0 && ", "}
              {courseCode} {section.type} ({section.online ? "online" : "time TBA"})
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function Unavailable({ blocks, start, end }: { blocks: Block[]; start: number; end: number }) {
  const gaps: { s: number; e: number }[] = [];
  let cursor = start;
  for (const b of [...blocks].sort((a, b2) => toMin(a.start) - toMin(b2.start))) {
    const bs = Math.max(start, toMin(b.start));
    const be = Math.min(end, toMin(b.end));
    if (bs > cursor) gaps.push({ s: cursor, e: bs });
    cursor = Math.max(cursor, be);
  }
  if (cursor < end) gaps.push({ s: cursor, e: end });
  return (
    <>
      {gaps.map((g) => (
        <span key={g.s} className="wc-unavail" style={{ top: (g.s - start) * PX_PER_MIN, height: (g.e - g.s) * PX_PER_MIN }} aria-hidden="true" />
      ))}
    </>
  );
}

/** Side-by-side lanes for overlapping meetings (should not happen in a valid schedule, but stay readable). */
function layoutDay(items: PlacedMeeting[]): { p: PlacedMeeting; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { p: PlacedMeeting; lane: number; lanes: number }[] = [];
  let cluster: { p: PlacedMeeting; lane: number; lanes: number }[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.push({ ...c, lanes });
    cluster = [];
    laneEnds.length = 0;
  };
  for (const p of sorted) {
    if (p.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((e) => e <= p.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = p.end;
    cluster.push({ p, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, p.end);
  }
  if (cluster.length) flush();
  return out;
}

/** Tiny week thumbnail for the schedule list. */
export function MiniWeek({ data, schedule }: { data: TermData; schedule: RankedSchedule }) {
  const placed = placedMeetings(data, schedule);
  const colors = courseColors(schedule);
  const start = 7 * 60;
  const span = 15 * 60;
  return (
    <span className="miniweek" aria-hidden="true">
      {WEEKDAYS.map((d) => (
        <span key={d} className="mw-col">
          {placed
            .filter((p) => p.day === d)
            .map((p) => (
              <span
                key={`${p.sectionId}-${p.start}`}
                className={`mw-ev c${colors.get(p.courseCode) ?? 0}`}
                style={{ top: `${((p.start - start) / span) * 100}%`, height: `${Math.max(4, ((p.end - p.start) / span) * 100)}%` }}
              />
            ))}
        </span>
      ))}
    </span>
  );
}

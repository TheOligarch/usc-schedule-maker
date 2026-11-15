import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AiError, explainSchedules } from "../lib/ai";
import { MAX_RESULT_LIMIT, USE_MOCKS } from "../lib/config";
import type { Blocker, PenaltyKind, RankedSchedule, TermData } from "../lib/contract-types";
import { chromeBinTransport, courseBinAvailable, type BinTransport } from "../lib/courseBin";
import { generateSchedules, type EngineRun } from "../lib/engine";
import { displayString, geShort, instructorNames, isLectureType, scheduleStats, sectionRmp, SECTION_TYPE_LABEL, unitsLabel } from "../lib/schedule";
import { fetchLiveSeats, liveSeatsAvailable, withLiveSeats, type LiveSeat } from "../lib/seats";
import { webregRegisterUrl } from "../lib/webreg";
import { fmtDays, fmtMeeting, fmtTime, freshnessLine } from "../lib/time";
import { allowedTimes, buildRequest, type AppState, type StepId } from "../state";
import { MiniWeek, WeekCalendar, courseColors } from "../components/WeekCalendar";
import { Card, Icon, Notice, Spinner } from "../components/ui";
import { AppliedFeedback, ScheduleFeedback } from "../components/ScheduleFeedback";
import { CourseBinDialog } from "../components/CourseBinDialog";
import { mockBinTransport } from "../mocks/mockCourseBin";

const LIMIT_OPTIONS = [10, 20, 30, 50, 100];
const SEAT_TTL_MS = 2 * 60 * 1000;

export const PENALTY_LABEL: Record<PenaltyKind, string> = {
  full: "Full",
  waitlist: "Waitlist",
  dClearance: "D-clearance",
  onlineOrTba: "Online / TBA",
  finalConflict: "Final conflict",
  ambiguousLink: "Pairing guess",
  noRmp: "Unrated prof",
  preference: "Preference",
};
const HEAVY: PenaltyKind[] = ["full", "waitlist", "dClearance", "onlineOrTba", "finalConflict", "ambiguousLink"];

/** How the app reaches WebReg to add to myCourseBin: the WebReg tab's content script, a demo stand-in, or nothing. */
function defaultBinTransport(): BinTransport | null {
  if (USE_MOCKS) return mockBinTransport();
  return courseBinAvailable() ? chromeBinTransport() : null;
}

interface Props {
  data: TermData;
  state: AppState;
  onChange: (patch: Partial<AppState>) => void;
  onEdit: (step: StepId) => void;
  /** Overrides how sections are added to myCourseBin (tests). */
  binTransport?: BinTransport | null;
  /** The bundled sample term is shown (no live data published). */
  sample?: boolean;
}

interface SeatState {
  seats: Record<string, LiveSeat>;
  fetchedAt: Record<string, number>; // course code -> epoch ms
  loading: boolean;
  error: string | null;
}

export function Results({ data, state, onChange, onEdit, binTransport, sample }: Props) {
  const request = useMemo(() => buildRequest(state, data), [state, data]);
  const requestKey = JSON.stringify(request);
  const [run, setRun] = useState<EngineRun | null>(null);
  const [running, setRunning] = useState(true);
  const [retry, setRetry] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explainState, setExplainState] = useState<"idle" | "loading" | "error">("idle");
  const [seatState, setSeatState] = useState<SeatState>({ seats: {}, fetchedAt: {}, loading: false, error: null });
  const listRef = useRef<HTMLOListElement>(null);
  const [binFor, setBinFor] = useState<{ schedule: RankedSchedule; index: number } | null>(null);
  const transport = useMemo(() => (binTransport === undefined ? defaultBinTransport() : binTransport), [binTransport]);

  // Build schedules whenever the request or the limit changes.
  useEffect(() => {
    const ctrl = new AbortController();
    setRunning(true);
    setEngineError(null);
    generateSchedules(data, JSON.parse(requestKey), { limit: state.limit, signal: ctrl.signal })
      .then((r) => {
        if (!ctrl.signal.aborted) setRun(r);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setEngineError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setRunning(false);
      });
    return () => ctrl.abort();
  }, [data, requestKey, state.limit, retry]);

  const schedules = run?.result.schedules ?? [];
  const selectedIndex = Math.max(0, schedules.findIndex((s) => s.id === selectedId));
  const selected: RankedSchedule | null = schedules[selectedIndex] ?? null;

  // AI explanations for the top 10 (re-requested only when that set changes).
  const topKey = schedules
    .slice(0, 10)
    .map((s) => s.id)
    .join("|");
  const explain = useMemo(
    () => async () => {
      const top = schedules.slice(0, 10);
      if (top.length === 0) return;
      setExplainState("loading");
      try {
        const res = await explainSchedules({ preferences: request.preferences, schedules: top.map((s) => ({ ...s, display: displayString(data, s) })) });
        setExplanations(Object.fromEntries(res.explanations.map((e) => [e.id, e.text])));
        setExplainState("idle");
      } catch (err) {
        setExplainState("error");
        if (!(err instanceof AiError)) console.warn("explain failed", err);
      }
    },
    [topKey, data, JSON.stringify(request.preferences)],
  );
  useEffect(() => {
    void explain();
  }, [explain]);

  // Live seat counts for the courses of the schedule being viewed.
  const refreshSeats = async (force: boolean) => {
    if (!selected || !liveSeatsAvailable()) return;
    const now = Date.now();
    const codes = selected.courses.map((c) => c.courseCode).filter((code) => force || !seatState.fetchedAt[code] || now - seatState.fetchedAt[code] > SEAT_TTL_MS);
    if (codes.length === 0) return;
    setSeatState((s) => ({ ...s, loading: true, error: null }));
    const res = await fetchLiveSeats(data.term.code, codes);
    setSeatState((s) => {
      const fetchedAt = { ...s.fetchedAt };
      for (const code of codes) if (!res.failed.includes(code)) fetchedAt[code] = Date.parse(res.fetchedAt) || now;
      return { seats: { ...s.seats, ...res.seats }, fetchedAt, loading: false, error: res.ok ? (res.failed.length ? `Could not refresh ${res.failed.join(", ")}.` : null) : (res.error ?? "Live seat counts are unavailable right now.") };
    });
  };
  useEffect(() => {
    void refreshSeats(false);
  }, [selected?.id]);

  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(schedules.length - 1, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
    setSelectedId(schedules[next]?.id ?? null);
    listRef.current?.querySelectorAll<HTMLButtonElement>("button.sched-item")[next]?.focus();
  };

  const allowed = allowedTimes(state.times);
  const total = run?.result.totalValid ?? 0;

  // The refine box needs schedules to refine; when nothing fits only the feedback already in effect is listed, so it can be removed.
  const applied = state.refinements.length > 0 && <Card title="Schedule feedback in effect"><AppliedFeedback state={state} disabled={running} onChange={onChange} /></Card>;

  if (engineError) {
    return (
      <div className="screen">
        <Notice tone="error">The schedule builder failed: {engineError}</Notice>
        <button type="button" className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>Retry schedule builder</button>
        {applied}
      </div>
    );
  }
  if (!run) {
    return (
      <div className="screen">
        <Card>
          <Spinner label="Building every schedule that fits your rules..." />
        </Card>
      </div>
    );
  }
  if (total === 0) return <div className="screen">{running && <Spinner label="Refreshing schedules…" />}
    {applied && <Notice tone="warn">No feasible alternatives fit your current rules. Remove feedback here to refresh; your requirements and pins are preserved.</Notice>}
    {applied}<NoResults blockers={run.result.blockers} onEdit={onEdit} /></div>;

  return (
    <div className="results">
      <aside className="sched-sidebar" aria-label="Ranked schedules">
        <div className="sidebar-head">
          <div>
            <strong className="big-num">
              {total.toLocaleString()}
              {run.truncated ? "+" : ""}
            </strong>{" "}
            section combination{total === 1 ? "" : "s"} fit
            <div className="muted small">
              {run.isMock ? "demo data · " : ""}{run.result.totalDistinct ?? schedules.length} distinct timetable{run.result.totalDistinct === 1 ? "" : "s"}{run.truncated ? "+" : ""} · built in {run.elapsedMs} ms
            </div>
          </div>
          <label className="limit-select">
            <span className="small muted">Show up to</span>
            <select value={state.limit} onChange={(e) => onChange({ limit: Number(e.target.value) })} aria-label="Number of schedules to show">
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {running && <Spinner label="Updating..." />}
        <ol className="sched-list" ref={listRef} onKeyDown={onListKey}>
          {schedules.map((s, i) => {
            const stats = scheduleStats(data, s);
            const flags = [...new Set(s.penalties.filter((p) => HEAVY.includes(p.kind)).map((p) => p.kind))];
            return (
              <li key={s.id}>
                <button type="button" className={`sched-item ${i === selectedIndex ? "on" : ""}`} aria-current={i === selectedIndex ? "true" : undefined} onClick={() => setSelectedId(s.id)}>
                  <span className="rank">#{i + 1}</span>
                  <span className="sched-item-body">
                    <span className="sched-item-top">
                      <span className="score">{s.score.toFixed(1)}</span>
                      <span className="muted small">
                        {s.units} u · {fmtDays(stats.daysUsed) || "TBA"}
                        {stats.earliest !== null && ` · ${fmtTime(stats.earliest, true)}-${fmtTime(stats.latest!, true)}`}
                      </span>
                    </span>
                    {flags.length > 0 && (
                      <span className="flags">
                        {flags.slice(0, 3).map((k) => (
                          <span key={k} className="tag tag-risk">
                            {PENALTY_LABEL[k]}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <MiniWeek data={data} schedule={s} />
                </button>
              </li>
            );
          })}
        </ol>
        {schedules.length >= state.limit && total > state.limit && state.limit < MAX_RESULT_LIMIT && (
          <button type="button" className="btn btn-ghost btn-sm full-width" onClick={() => onChange({ limit: Math.min(MAX_RESULT_LIMIT, state.limit + 10) })}>
            Show 10 more
          </button>
        )}
      </aside>

      {selected && (
        <section className="sched-main" aria-busy={running} aria-label={`Schedule ${selectedIndex + 1}`}>
          <ScheduleHeader
            data={data}
            schedule={selected}
            index={selectedIndex}
            count={schedules.length}
            onPrev={() => setSelectedId(schedules[selectedIndex - 1]?.id ?? null)}
            onNext={() => setSelectedId(schedules[selectedIndex + 1]?.id ?? null)}
            onEdit={onEdit}
            busy={running}
            onAddToBin={() => { if (!running) setBinFor({ schedule: selected, index: selectedIndex }); }}
          />
          {Object.values(state.sectionPins).some((ids) => ids.length) && <p className="small">Required sections: {Object.entries(state.sectionPins).filter(([, ids]) => ids.length).map(([c, ids]) => `${c} ${ids.join(" + ")}`).join(", ")}</p>}
          <ScheduleFeedback data={data} schedule={selected} index={selectedIndex} state={state} running={running} onChange={onChange} />
          <Explanation index={selectedIndex} text={explanations[selected.id]} state={explainState} onRetry={() => void explain()} />
          <Card className="cal-card">
            <WeekCalendar data={data} schedule={selected} allowed={allowed} highlight={highlight} onHighlight={setHighlight} />
          </Card>
          <SectionDetails
            sample={sample ?? false}
            data={data}
            schedule={selected}
            seats={seatState}
            onRefreshSeats={() => void refreshSeats(true)}
            highlight={highlight}
            onHighlight={setHighlight}
          />
        </section>
      )}
      {binFor && <CourseBinDialog data={data} schedule={binFor.schedule} index={binFor.index} transport={transport} onClose={() => setBinFor(null)} />}
    </div>
  );
}

function ScheduleHeader({
  data,
  schedule,
  index,
  count,
  onPrev,
  onNext,
  onEdit,
  onAddToBin,
  busy,
}: {
  data: TermData;
  schedule: RankedSchedule;
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onEdit: (s: StepId) => void;
  onAddToBin: () => void;
  busy: boolean;
}) {
  const stats = scheduleStats(data, schedule);
  return (
    <header className="sched-head">
      <div>
        <h1>
          Schedule #{index + 1} <span className="score-badge">fit score {schedule.score.toFixed(1)}</span>
        </h1>
        <p className="muted small stats-line">
          <span>{schedule.units} units</span>
          <span>{stats.daysUsed.length} day{stats.daysUsed.length === 1 ? "" : "s"} on campus</span>
          {stats.earliest !== null && (
            <span>
              {fmtTime(stats.earliest)} - {fmtTime(stats.latest!)}
            </span>
          )}
          <span>longest gap {stats.maxGap >= 60 ? `${Math.round(stats.maxGap / 6) / 10} hr` : `${stats.maxGap} min`}</span>
          {stats.avgRmp !== null && <span>avg prof rating {stats.avgRmp.toFixed(1)}</span>}
        </p>
      </div>
      <div className="row gap-sm">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onAddToBin} title="Add every section of this schedule to your WebReg myCourseBin">
          <Icon name="plus" size={14} /> Add all to myCourseBin
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit("requirements")}>
          Edit requirements
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit("interview")}>
          Edit preferences
        </button>
        <div className="pager" role="group" aria-label="Browse schedules">
          <button type="button" className="icon-btn" disabled={index === 0} onClick={onPrev} aria-label="Previous schedule">
            <Icon name="arrowLeft" />
          </button>
          <span className="small">
            {index + 1} / {count}
          </span>
          <button type="button" className="icon-btn" disabled={index >= count - 1} onClick={onNext} aria-label="Next schedule">
            <Icon name="arrowRight" />
          </button>
        </div>
      </div>
    </header>
  );
}

function Explanation({ index, text, state, onRetry }: { index: number; text: string | undefined; state: "idle" | "loading" | "error"; onRetry: () => void }) {
  if (index >= 10) return null;
  return (
    <div className="explain" aria-live="polite">
      <Icon name="sparkle" />
      <div>
        <span className="explain-label">Why this schedule</span>
        {text ? <p>{text}</p> : state === "loading" ? <p className="skeleton">Writing a short explanation...</p> : state === "error" ? (
          <p>
            Explanation unavailable.{" "}
            <button type="button" className="link-btn" onClick={onRetry}>
              Try again
            </button>
          </p>
        ) : (
          <p className="muted">No explanation for this schedule.</p>
        )}
      </div>
    </div>
  );
}

function SectionDetails({
  sample,
  data,
  schedule,
  seats,
  onRefreshSeats,
  highlight,
  onHighlight,
}: {
  sample: boolean;
  data: TermData;
  schedule: RankedSchedule;
  seats: SeatState;
  onRefreshSeats: () => void;
  highlight: string | null;
  onHighlight: (c: string | null) => void;
}) {
  const colors = courseColors(schedule);
  const live = liveSeatsAvailable();
  // The oldest data on screen: live fetches where every course has one, else the term file.
  const fetched = schedule.courses.map((c) => seats.fetchedAt[c.courseCode]);
  const updatedAt = fetched.length && fetched.every(Boolean) ? Math.min(...fetched) : data.term.scrapedAt;
  return (
    <Card
      title="Sections"
      subtitle={`${freshnessLine(updatedAt, { sample })}.${live || sample ? "" : " Install the extension to refresh seat counts."}`}
      actions={
        live && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshSeats} disabled={seats.loading}>
            <Icon name="refresh" size={14} /> {seats.loading ? "Refreshing..." : "Refresh seats"}
          </button>
        )
      }
    >
      {seats.error && <Notice tone="warn">{seats.error} Showing the last downloaded numbers instead.</Notice>}
      <div className="course-details">
        {schedule.courses.map((c) => {
          const course = data.courses[c.courseCode];
          const pens = schedule.penalties.filter((p) => p.sectionId && c.sectionIds.includes(p.sectionId));
          return (
            <article
              key={c.courseCode}
              className={`course-detail c${colors.get(c.courseCode) ?? 0} ${highlight === c.courseCode ? "lit" : ""}`}
              onMouseEnter={() => onHighlight(c.courseCode)}
              onMouseLeave={() => onHighlight(null)}
            >
              <header>
                <span className="swatch" aria-hidden="true" />
                <h3>
                  {c.courseCode} <span className="title">{course?.title}</span>
                </h3>
                <span className="muted small">
                  {course && `${unitsLabel(course.units)} units`}
                  {course?.ge.length ? ` · ${course.ge.map(geShort).join(", ")}` : ""}
                </span>
              </header>
              <div className="table-scroll">
                <table className="sections">
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Section</th>
                      <th scope="col">When</th>
                      <th scope="col">Instructor</th>
                      <th scope="col">Rating</th>
                      <th scope="col">Seats</th>
                      <th scope="col">
                        <span className="sr-only">Register</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.sectionIds.map((id) => {
                      const raw = data.sections[id];
                      if (!raw) return null;
                      const sec = withLiveSeats(raw, seats.seats);
                      const isLive = Boolean(seats.seats[id]);
                      const rmp = isLectureType(sec.type) ? sectionRmp(data, sec) : null;
                      const open = Math.max(0, sec.seats.total - sec.seats.registered);
                      return (
                        <tr key={id}>
                          <td>{SECTION_TYPE_LABEL[sec.type]}</td>
                          <td className="mono">{sec.id}</td>
                          <td>
                            {sec.meetings.length === 0 ? <span className="tag tag-risk">{sec.online ? "Online" : "TBA"}</span> : sec.meetings.map((m, i) => <div key={i}>{fmtMeeting(m, true)}</div>)}
                            {sec.online && sec.meetings.length > 0 && <span className="tag tag-soft">Online</span>}
                          </td>
                          <td>{instructorNames(sec)}</td>
                          <td>
                            {isLectureType(sec.type) ? (
                              rmp ? (
                                <span className="rmp">
                                  <a href={`https://www.ratemyprofessors.com/professor/${encodeURIComponent(rmp.teacher.legacyId)}`} target="_blank" rel="noopener noreferrer" className="rmp-score">
                                    {rmp.teacher.avg.toFixed(1)}
                                  </a>
                                  <span className="muted small">
                                    {" "}
                                    ({rmp.teacher.count} rating{rmp.teacher.count === 1 ? "" : "s"})
                                  </span>
                                  {rmp.match === "initial" && (
                                    <span className="tag tag-soft" title="Matched by first initial and last name; may be a different person">
                                      possible match
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="muted small">Not rated</span>
                              )
                            ) : (
                              <span className="muted small" aria-label="Not applicable">
                                -
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={sec.isFull ? "seats seats-full" : open <= 5 ? "seats seats-low" : "seats"}>
                              {sec.isFull ? "Full" : `${open} open`}
                            </span>
                            <span className="muted small">
                              {" "}
                              {sec.seats.registered}/{sec.seats.total}
                            </span>
                            {isLive && <span className="live-dot" title="Live count" aria-label="live" />}
                            {sec.dClearance && <span className="tag tag-risk">D-clearance</span>}
                          </td>
                          <td>
                            <a
                              className="btn btn-link btn-sm"
                              href={webregRegisterUrl(c.courseCode, c.sectionIds, data.term.code)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Register for ${c.courseCode} in WebReg, with this schedule's sections highlighted`}
                            >
                              Register <Icon name="external" size={12} />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(pens.length > 0 || course?.prereqText || c.sectionIds.some((id) => data.sections[id]?.notes)) && (
                <ul className="section-warnings small">
                  {pens.map((p, i) => (
                    <li key={i}>
                      <Icon name="alert" size={12} /> {p.message}
                    </li>
                  ))}
                  {course?.prereqText && (
                    <li>
                      <Icon name="info" size={12} /> {course.prereqText}
                    </li>
                  )}
                  {c.sectionIds.map((id) =>
                    data.sections[id]?.notes ? (
                      <li key={`n-${id}`}>
                        <Icon name="info" size={12} /> Section {id}: {data.sections[id].notes}
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      <p className="credit small muted">Ratings from RateMyProfessors.com</p>
    </Card>
  );
}

const BLOCKER_STEP: Record<string, { step: StepId; label: string }> = {
  allowedTimes: { step: "requirements", label: "Widen allowed times" },
  unitCap: { step: "requirements", label: "Raise the unit cap" },
  timeConflict: { step: "requirements", label: "Change courses" },
  noValidLinkCombo: { step: "requirements", label: "Change courses" },
  flexSlot: { step: "interview", label: "Edit shortlists" },
  noCourses: { step: "requirements", label: "Add courses" },
};

function NoResults({ blockers, onEdit }: { blockers: Blocker[]; onEdit: (s: StepId) => void }) {
  const [top, ...rest] = blockers;
  return (
    <div className="screen">
      <Card className="no-results" title="No schedule fits all of your requirements" subtitle="Here is what is ruling schedules out, biggest blocker first.">
        {top && (
          <div className="blocker blocker-top">
            <span className="blocker-rank">Biggest blocker</span>
            <p>{top.message}</p>
            {top.eliminated > 0 && <span className="muted small">Ruled out {top.eliminated.toLocaleString()} combination{top.eliminated === 1 ? "" : "s"}.</span>}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onEdit(BLOCKER_STEP[top.constraint]?.step ?? "requirements")}>
              {BLOCKER_STEP[top.constraint]?.label ?? "Adjust requirements"} <Icon name="arrowRight" size={14} />
            </button>
          </div>
        )}
        {rest.length > 0 && (
          <ol className="blockers">
            {rest.map((b, i) => (
              <li key={`${b.constraint}-${i}`} className="blocker">
                <p>{b.message}</p>
                {b.eliminated > 0 && <span className="muted small">Ruled out {b.eliminated.toLocaleString()}.</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_IS_MOCK, AiError, interviewTurn, type AiSource } from "../lib/ai";
import { MAX_INTERVIEW_QUESTIONS, MAX_SHORTLIST } from "../lib/config";
import type { Course, InterviewHistoryItem, InterviewQuestion, Preferences, Shortlist, TermData } from "../lib/contract-types";
import { geLabel, geShort, unitsLabel } from "../lib/schedule";
import { toHHMM, toMin } from "../lib/time";
import { alignedShortlists, allowedTimes, interviewSignature, type AppState, type InterviewResult, type SlotDef } from "../state";
import { CourseSearch } from "../components/CourseSearch";
import { Card, Icon, Notice, Segmented, Spinner, StepFooter } from "../components/ui";

interface Props {
  data: TermData;
  /** True while showing the bundled sample term: the AI's course table cannot shortlist from it, so the scripted interview runs. */
  sampleData: boolean;
  state: AppState;
  onChange: (patch: Partial<AppState>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function Interview({ data, sampleData, state, onChange, onBack, onNext }: Props) {
  const [question, setQuestion] = useState<InterviewQuestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(sampleData);
  const [freeText, setFreeText] = useState("");
  const [source, setSource] = useState<AiSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sig = interviewSignature(state);

  const ask = useCallback(
    async (history: InterviewHistoryItem[], forceOffline = offline) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const blocks = Object.values(allowedTimes(state.times)).flat();
        const hardHours = blocks.length
          ? { earliestStart: toHHMM(Math.min(...blocks.map((b) => toMin(b.start)))), latestEnd: toHHMM(Math.max(...blocks.map((b) => toMin(b.end)))) }
          : undefined;
        const { res, source: from } = await interviewTurn(
          {
            termCode: data.term.code,
            required: state.required,
            slots: state.slots.map((s) => ({ label: s.label, kind: s.kind, ...(s.geCategory ? { geCategory: s.geCategory } : {}) })),
            history,
            ...(hardHours ? { hardHours } : {}),
          },
          data,
          { offline: forceOffline, signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        setSource(from);
        if (res.done) {
          setQuestion(null);
          onChange({ history, interview: { preferences: res.preferences, shortlists: res.shortlists, summary: res.summary }, interviewFor: sig });
        } else {
          setQuestion(res.question);
        }
      } catch (err) {
        if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof AiError ? err.message : "Something went wrong while talking to the AI service.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [data, state.required, state.slots, state.times, offline, onChange, sig],
  );

  // Ask for the next question on arrival; abort it if the screen goes away (StrictMode
  // mounts twice in dev, so the second mount re-asks after the first one is aborted).
  useEffect(() => {
    if (!state.interview) void ask(state.history);
    return () => abortRef.current?.abort();
    // Runs once per visit, not per answer: answers call ask() themselves.
  }, []);

  const answer = (text: string, extra?: string) => {
    if (!question) return;
    const item: InterviewHistoryItem = { questionId: question.id, question: question.text, answer: text };
    if (extra?.trim()) item.freeText = extra.trim();
    const history = [...state.history, item];
    setQuestion(null);
    setFreeText("");
    onChange({ history });
    void ask(history);
  };

  const rewind = (index: number) => {
    const history = state.history.slice(0, index);
    setQuestion(null);
    onChange({ history, interview: null, interviewFor: null });
    void ask(history);
  };

  const redo = () => rewind(0);
  const skip = () => {
    abortRef.current?.abort();
    setLoading(false);
    setQuestion(null);
    onChange({
      interview: {
        preferences: { daySpread: "neutral", breaks: "neutral", maxGapMinutes: null, preferredDaysOff: [], comfortStart: null, comfortEnd: null, notes: null },
        shortlists: state.slots.map((s) => ({ label: s.label, options: [] })),
        summary: [],
      },
      interviewFor: sig,
    });
  };

  const done = state.interview !== null;
  const stale = done && state.interviewFor !== sig;

  return (
    <div className="screen">
      {!done && (
        <Card
          className="interview-card"
          title={
            <>
              <Icon name="sparkle" /> Quick interview
            </>
          }
          subtitle={`A few questions (up to ${MAX_INTERVIEW_QUESTIONS}) about your interests and week layout. For each open requirement, we suggest up to five real courses. Edit the list before building schedules; each schedule chooses one course per slot.`}
          actions={
            AI_IS_MOCK || offline || source === "mock" ? (
              <span className="pill pill-muted">Offline demo interview</span>
            ) : source === "fallback" ? (
              <span className="pill pill-muted" title="The AI model was unavailable, so the service used its built-in questions">
                Guided questions
              </span>
            ) : (
              <span className="pill pill-gold">AI</span>
            )
          }
        >
          <div className="chat" aria-live="polite">
            {state.history.map((h, i) => (
              <div key={`${h.questionId}-${i}`} className="turn">
                <div className="bubble bubble-ai">
                  <span className="q-num">{i + 1}</span>
                  {h.question}
                </div>
                <div className="bubble bubble-me">
                  <span>
                    {h.answer}
                    {h.freeText && h.freeText !== h.answer && <span className="bubble-note">"{h.freeText}"</span>}
                  </span>
                  <button type="button" className="link-btn small" onClick={() => rewind(i)} aria-label={`Change your answer to question ${i + 1}`}>
                    change
                  </button>
                </div>
              </div>
            ))}
            {question && (
              <div className="turn current">
                <div className="bubble bubble-ai">
                  <span className="q-num">{state.history.length + 1}</span>
                  {question.text}
                </div>
                <div className="quick-replies" role="group" aria-label="Quick replies">
                  {question.options.map((opt) => (
                    <button key={opt} type="button" className="quick-reply" onClick={() => answer(opt, freeText)}>
                      {opt}
                    </button>
                  ))}
                </div>
                <form
                  className="free-text"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (freeText.trim()) answer(freeText.trim());
                  }}
                >
                  <label className="sr-only" htmlFor="free-text">
                    Add a detail (optional)
                  </label>
                  <input
                    id="free-text"
                    type="text"
                    maxLength={300}
                    placeholder="Optional: add a detail, then tap an answer - or just type and press Enter"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                  />
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={!freeText.trim()}>
                    Send
                  </button>
                </form>
              </div>
            )}
            {loading && <Spinner label={state.history.length === 0 ? "Getting your first question..." : "Thinking..."} />}
            {error && (
              <Notice
                tone="error"
                action={
                  <div className="row gap-sm">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void ask(state.history)}>
                      <Icon name="refresh" size={14} /> Retry
                    </button>
                    {!AI_IS_MOCK && !offline && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setOffline(true);
                          void ask(state.history, true);
                        }}
                      >
                        Use offline interview
                      </button>
                    )}
                  </div>
                }
              >
                {error}
              </Notice>
            )}
          </div>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (state.history.length / MAX_INTERVIEW_QUESTIONS) * 100)}%` }} />
          </div>
          <p className="muted small progress-label">
            {state.history.length} of up to {MAX_INTERVIEW_QUESTIONS} answered
          </p>
        </Card>
      )}

      {done && state.interview && (
        <>
          {stale && (
            <Notice
              tone="warn"
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={redo}>
                  Redo interview
                </button>
              }
            >
              Your courses or slots changed after the interview. The shortlists below may not match; redo the interview or edit them.
            </Notice>
          )}
          <InterviewSummary data={data} slots={state.slots} required={state.required} result={state.interview} onChange={(interview) => onChange({ interview })} onRedo={redo} />
        </>
      )}

      <StepFooter
        back={
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <Icon name="arrowLeft" /> Back
          </button>
        }
        next={
          done ? (
            <button type="button" className="btn btn-primary" onClick={onNext}>
              Build my schedules <Icon name="arrowRight" />
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={skip}>
              Skip interview
            </button>
          )
        }
      />
    </div>
  );
}

const GAP_OPTIONS: (number | null)[] = [null, 30, 60, 90, 120, 180];

function InterviewSummary({
  data,
  slots,
  required,
  result,
  onChange,
  onRedo,
}: {
  data: TermData;
  slots: SlotDef[];
  required: string[];
  result: InterviewResult;
  onChange: (r: InterviewResult) => void;
  onRedo: () => void;
}) {
  const prefs = result.preferences;
  const setPrefs = (patch: Partial<Preferences>) => onChange({ ...result, preferences: { ...prefs, ...patch } });
  const shortlists = alignedShortlists(slots, result);
  const setShortlist = (label: string, next: Shortlist) => onChange({ ...result, shortlists: [...shortlists.filter((s) => s.label !== label), next].sort((a, b) => shortlists.findIndex((x) => x.label === a.label) - shortlists.findIndex((x) => x.label === b.label)) });

  return (
    <>
      <Card
        title={
          <>
            <Icon name="sparkle" /> Here is what we learned
          </>
        }
        subtitle="Everything below is editable. These soft preferences rank your schedules; your hard requirements never change."
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRedo}>
            <Icon name="refresh" size={14} /> Redo interview
          </button>
        }
      >
        <SummaryBullets bullets={result.summary} onChange={(summary) => onChange({ ...result, summary })} />

        <div className="pref-grid">
          <div className="field">
            <span className="field-label" id="pref-spread">
              Week layout
            </span>
            <Segmented
              label="Week layout"
              value={prefs.daySpread}
              onChange={(daySpread) => setPrefs({ daySpread })}
              options={[
                { value: "compact", label: "Fewer days" },
                { value: "neutral", label: "No preference" },
                { value: "spread", label: "Spread out" },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Between classes</span>
            <Segmented
              label="Between classes"
              value={prefs.breaks}
              onChange={(breaks) => setPrefs({ breaks })}
              options={[
                { value: "avoid", label: "Back-to-back" },
                { value: "neutral", label: "No preference" },
                { value: "prefer", label: "Breaks" },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="pref-gap">Longest gap you'd like</label>
            <select id="pref-gap" value={prefs.maxGapMinutes ?? ""} onChange={(e) => setPrefs({ maxGapMinutes: e.target.value === "" ? null : Number(e.target.value) })}>
              {GAP_OPTIONS.map((g) => (
                <option key={String(g)} value={g ?? ""}>
                  {g === null ? "Any length" : g < 60 ? `${g} minutes` : `${g / 60} hour${g === 60 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-wide">
            <label htmlFor="pref-notes">Anything else (notes for the ranking)</label>
            <textarea id="pref-notes" rows={2} maxLength={500} value={prefs.notes ?? ""} onChange={(e) => setPrefs({ notes: e.target.value || null })} />
          </div>
        </div>
      </Card>

      {slots.length > 0 && (
        <Card title="Shortlists for your open slots" subtitle={`These lists reflect your interests for the open requirements you added. Edit up to ${MAX_SHORTLIST} real courses per slot; each schedule chooses one from each list. Check your course plan to confirm what counts toward your degree.`}>
          <div className="shortlists">
            {slots.map((slot) => (
              <ShortlistEditor key={slot.id} data={data} slot={slot} required={required} shortlist={shortlists.find((s) => s.label === slot.label)!} onChange={(next) => setShortlist(slot.label, next)} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function SummaryBullets({ bullets, onChange }: { bullets: string[]; onChange: (b: string[]) => void }) {
  return (
    <div className="summary">
      <ul className="summary-list">
        {bullets.map((b, i) => (
          <li key={i}>
            <Icon name="check" size={14} />
            <input type="text" aria-label={`Summary point ${i + 1}`} value={b} maxLength={240} onChange={(e) => onChange(bullets.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="icon-btn" aria-label={`Remove summary point ${i + 1}`} onClick={() => onChange(bullets.filter((_, j) => j !== i))}>
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...bullets, ""])}>
        <Icon name="plus" size={14} /> Add a point
      </button>
    </div>
  );
}

function ShortlistEditor({ data, slot, required, shortlist, onChange }: { data: TermData; slot: SlotDef; required: string[]; shortlist: Shortlist; onChange: (s: Shortlist) => void }) {
  const exclude = useMemo(() => new Set([...required, ...shortlist.options.map((o) => o.courseCode)]), [required, shortlist.options]);
  const filter = useMemo(() => (slot.kind === "GE" && slot.geCategory ? (c: Course) => c.ge.includes(slot.geCategory!) : undefined), [slot.kind, slot.geCategory]);
  const full = shortlist.options.length >= MAX_SHORTLIST;
  return (
    <div className="shortlist">
      <header>
        <h3>{slot.label}</h3>
        <span className="muted small">{slot.kind === "GE" ? geLabel(slot.geCategory ?? "") : "Elective"}</span>
      </header>
      {shortlist.options.length === 0 && <p className="empty small">No options yet. Add at least one course or this slot will block every schedule.</p>}
      <ol className="shortlist-options">
        {shortlist.options.map((o) => {
          const c = data.courses[o.courseCode];
          return (
            <li key={o.courseCode}>
              <div>
                <span className="code">{o.courseCode}</span> <span className="title">{c?.title ?? "Not offered this term"}</span>
                {c && (
                  <span className="muted small">
                    {" "}
                    · {unitsLabel(c.units)} units{c.ge.length ? ` · ${c.ge.map(geShort).join(", ")}` : ""}
                  </span>
                )}
                {o.reason && <p className="reason small">{o.reason}</p>}
              </div>
              <button type="button" className="icon-btn" aria-label={`Remove ${o.courseCode} from ${slot.label}`} onClick={() => onChange({ ...shortlist, options: shortlist.options.filter((x) => x.courseCode !== o.courseCode) })}>
                <Icon name="x" size={14} />
              </button>
            </li>
          );
        })}
      </ol>
      <CourseSearch
        data={data}
        exclude={exclude}
        filter={filter}
        disabled={full}
        label={`Add a course to ${slot.label}`}
        placeholder={full ? `Shortlist is full (${MAX_SHORTLIST})` : slot.kind === "GE" ? `Add a ${geShort(slot.geCategory ?? "GE")} course` : "Add any course"}
        onPick={(c) => onChange({ ...shortlist, options: [...shortlist.options, { courseCode: c.code, reason: "Added by you." }] })}
      />
    </div>
  );
}

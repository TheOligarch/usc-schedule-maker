import { useEffect, useMemo, useRef, useState } from "react";
import type { RankedSchedule, TermData } from "../lib/contract-types";
import { proposeRefinement } from "../lib/refineCheck";
import { RefinementError, suggestRefinements } from "../lib/refinement";
import type { AppState } from "../state";
import { Card, Notice } from "./ui";

interface Conflict {
  message: string;
  reasons: string[];
}

export function ScheduleFeedback({ data, schedule, index, state, running, onChange }: {
  data: TermData; schedule: RankedSchedule | null; index: number; state: AppState;
  running: boolean; onChange: (patch: Partial<AppState>) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const suggestions = useMemo(() => suggestRefinements(data, schedule), [data, schedule]);
  const busy = running || checking;

  const submit = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setChecking(true); setError(null); setConflict(null); setApplied(null);
    try {
      const res = await proposeRefinement(text, data, state, schedule, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (!res.ok) { setConflict({ message: res.message, reasons: res.reasons }); return; }
      onChange({ refinements: [...state.refinements, res.refinement] });
      setApplied(res.refinement.ignored ? `Applied “${res.refinement.summary}”. Not used: “${res.refinement.ignored}”. Add it as a separate change if it matters.` : `Applied “${res.refinement.summary}”.`);
      setText("");
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof RefinementError ? err.message : `Could not check this change: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!ctrl.signal.aborted) setChecking(false);
    }
  };

  return <Card title={schedule ? `Refine schedule #${index + 1}` : "Refine your schedules"}>
    <p className="small muted">Describe what to change: days, start or end times, gaps, a course’s lab or discussion, a section or an instructor. We’ll refresh alternatives with your existing courses, section pins and preferences, and only if at least one schedule still fits.</p>
    <form className="field" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <label htmlFor="schedule-feedback">Schedule feedback</label>
      <textarea id="schedule-feedback" maxLength={300} rows={2} value={text} onChange={e => { setText(e.target.value); setConflict(null); }} placeholder={suggestions[0] ? `e.g. ${suggestions[0]}` : "e.g. No classes before 10am"} disabled={busy} />
      {suggestions.length > 0 && <div className="row gap-sm wrap" aria-label="Suggestions from this schedule">
        {suggestions.map(s => <button key={s} type="button" className="chip-btn btn btn-ghost btn-sm" disabled={busy} onClick={() => { setText(s); setConflict(null); setError(null); }}>{s}</button>)}
      </div>}
      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !text.trim()}>{checking ? "Checking this change…" : running ? "Refreshing schedules…" : "Refresh schedules and rankings"}</button>
    </form>
    {error && <Notice tone="error">{error}</Notice>}
    {conflict && <Notice tone="warn"><span>{conflict.message}</span>{conflict.reasons.length > 0 && <ul className="small">{conflict.reasons.map(r => <li key={r}>{r}</li>)}</ul>}</Notice>}
    {applied && !conflict && !error && <p className="small" role="status">{applied}</p>}
    {state.refinements.length > 0 && <div aria-label="Applied schedule feedback" aria-live="polite">
      <p className="small">Applied to every new alternative:</p>
      <ul>{state.refinements.map((r, i) => <li key={`${i}-${r.scheduleId}`}>
        <span title={r.text}>{r.summary}</span>{" "}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remove feedback: ${r.summary}`} onClick={() => onChange({ refinements: state.refinements.filter((_, at) => at !== i) })}>Remove</button>
      </li>)}</ul>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onChange({ refinements: [] })}>Clear feedback and refresh</button>
    </div>}
  </Card>;
}

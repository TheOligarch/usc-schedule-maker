import { useState } from "react";
import type { RankedSchedule, TermData } from "../lib/contract-types";
import { parseRefinement } from "../lib/refinement";
import type { AppState } from "../state";
import { Card, Notice } from "./ui";

export function ScheduleFeedback({ data, schedule, index, state, running, onChange }: {
  data: TermData; schedule: RankedSchedule | null; index: number; state: AppState;
  running: boolean; onChange: (patch: Partial<AppState>) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return <Card title={schedule ? `Refine schedule #${index + 1}` : "Refine your schedules"}>
    <p className="small muted">Describe a change to this schedule. We’ll refresh alternatives using your existing courses, section pins and preferences.</p>
    <form className="field" onSubmit={e => {
      e.preventDefault();
      try {
        const refinement = parseRefinement(text, data, schedule);
        onChange({ refinements: [...state.refinements, refinement] });
        setText(""); setError(null);
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    }}>
      <label htmlFor="schedule-feedback">Schedule feedback</label>
      <textarea id="schedule-feedback" maxLength={300} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="I dont want a BISC lab on Friday" disabled={running} />
      <span className="small muted">Use “no” or “avoid”, a course/department and component, then a day or time. Examples: “no classes before 10am” or “avoid this lab on Friday”. Apply one change at a time.</span>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={running || !text.trim()}>{running ? "Refreshing schedules…" : "Refresh schedules and rankings"}</button>
    </form>
    {error && <Notice tone="error">{error}</Notice>}
    {state.refinements.length > 0 && <div aria-label="Applied schedule feedback" aria-live="polite">
      <p className="small">Applied to every new alternative:</p>
      <ul>{state.refinements.map((r, i) => <li key={`${i}-${r.scheduleId}`}>
        <span title={r.text}>{r.summary}</span>{" "}
        <button type="button" className="btn btn-ghost btn-sm" disabled={running} aria-label={`Remove feedback: ${r.summary}`} onClick={() => onChange({ refinements: state.refinements.filter((_, at) => at !== i) })}>Remove</button>
      </li>)}</ul>
      <button type="button" className="btn btn-ghost btn-sm" disabled={running} onClick={() => onChange({ refinements: [] })}>Clear feedback and refresh</button>
    </div>}
  </Card>;
}

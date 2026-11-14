import type { Importance, TermRef } from "../lib/contract-types";
import { relativeTime } from "../lib/time";
import type { DataSource } from "../lib/termData";
import { Card, Icon, StepFooter } from "../components/ui";

const FACTORS: { key: keyof Importance; label: string; low: string; high: string; help: string }[] = [
  { key: "rmp", label: "Professor ratings", low: "Don't care", high: "Top priority", help: "How much RateMyProfessors ratings of lecture instructors should move a schedule up or down." },
  { key: "daySpread", label: "How classes spread over the week", low: "Don't care", high: "Top priority", help: "Matching your preference for stacking classes on a few days or spreading them out." },
  { key: "breaks", label: "Breaks between classes", low: "Don't care", high: "Top priority", help: "Matching your preference for back-to-back classes or time in between." },
  { key: "seatRisk", label: "Getting a seat", low: "Don't care", high: "Top priority", help: "Pushing full, waitlisted and D-clearance sections down the list." },
  { key: "finals", label: "Final exam conflicts", low: "Don't care", high: "Top priority", help: "Pushing schedules with overlapping final exams down the list." },
];

interface Props {
  terms: TermRef[];
  termCode: string | null;
  source: DataSource | null;
  importance: Importance;
  onTerm: (code: string) => void;
  onImportance: (next: Importance) => void;
  onNext: () => void;
  canContinue: boolean;
}

export function Priorities({ terms, termCode, source, importance, onTerm, onImportance, onNext, canContinue }: Props) {
  return (
    <div className="screen">
      <div className="intro">
        <h1>Build schedules around what you actually want.</h1>
        <p className="lead">
          Tell us the hard rules once - courses, times, unit cap, minimum professor rating - then answer 10 quick questions. We build every schedule that follows your rules and rank them by
          how well they fit you.
        </p>
      </div>

      <Card title="Term" subtitle={source === "sample" ? "Live course data has not been published yet, so a sample term is shown." : "Course data refreshes nightly from the USC Schedule of Classes."}>
        <div className="term-picker" role="radiogroup" aria-label="Term">
          {terms.map((t) => (
            <button key={t.code} type="button" role="radio" aria-checked={t.code === termCode} className={`term-option ${t.code === termCode ? "on" : ""}`} onClick={() => onTerm(t.code)}>
              <Icon name="calendar" />
              <span>
                <strong>{t.name}</strong>
                <span className="muted small">updated {relativeTime(t.scrapedAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="What matters to you?" subtitle="Rate each factor from 1 (don't care) to 10 (top priority). These weights decide how schedules are ranked; they never remove a schedule.">
        <div className="sliders">
          {FACTORS.map((f) => (
            <div key={f.key} className="slider-row">
              <div className="slider-label">
                <label htmlFor={`imp-${f.key}`}>{f.label}</label>
                <span className="muted small">{f.help}</span>
              </div>
              <div className="slider-control">
                <input
                  id={`imp-${f.key}`}
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={importance[f.key]}
                  aria-valuetext={`${importance[f.key]} of 10`}
                  style={{ ["--pct" as string]: `${((importance[f.key] - 1) / 9) * 100}%` }}
                  onChange={(e) => onImportance({ ...importance, [f.key]: Number(e.target.value) })}
                />
                <div className="slider-ends muted small" aria-hidden="true">
                  <span>{f.low}</span>
                  <span>{f.high}</span>
                </div>
              </div>
              <output className="slider-value" htmlFor={`imp-${f.key}`}>
                {importance[f.key]}
              </output>
            </div>
          ))}
        </div>
      </Card>

      <StepFooter
        next={
          <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={onNext}>
            Next: requirements <Icon name="arrowRight" />
          </button>
        }
      />
    </div>
  );
}

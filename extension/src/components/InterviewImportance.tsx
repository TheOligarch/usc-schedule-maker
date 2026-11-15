import type { Importance } from "../lib/contract-types";

type InterviewFactor = "daySpread" | "breaks";

// Backend AI and fallback share planned IDs; the bundled offline interview uses
// camelCase IDs. Never infer the factor from model-generated question wording.
const QUESTION_FACTORS: Record<string, InterviewFactor> = {
  "day-spread": "daySpread",
  daySpread: "daySpread",
  breaks: "breaks",
  "max-gap": "breaks",
  "breaks-and-gap": "breaks",
  maxGap: "breaks",
};

export function InterviewImportance({ questionId, importance, onImportance }: {
  questionId: string;
  importance: Importance;
  onImportance: (importance: Importance) => void;
}) {
  const factor = Object.hasOwn(QUESTION_FACTORS, questionId) ? QUESTION_FACTORS[questionId] : undefined;
  if (!factor) return null;
  const value = importance[factor];
  const id = `interview-importance-${factor}`;
  return (
    <div className="slider-row slider-contextual">
      <div className="slider-label">
        <label htmlFor={id}>{factor === "daySpread" ? "Week layout importance" : "Breaks and gaps importance"}</label>
        <span className="muted small" id={`${id}-help`}>
          {factor === "daySpread" ? "How important is matching your week layout?" : "How important is matching your breaks and longest-gap preferences?"}
        </span>
      </div>
      <div className="slider-control">
        <input
          id={id}
          type="range"
          min={1}
          max={10}
          step={1}
          value={value}
          aria-valuetext={`${value} of 10`}
          aria-describedby={`${id}-help`}
          style={{ ["--pct" as string]: `${((value - 1) / 9) * 100}%` }}
          onChange={(e) => onImportance({ ...importance, [factor]: Number(e.target.value) })}
        />
        <div className="slider-ends muted small" aria-hidden="true">
          <span>Don't care</span>
          <span>Top priority</span>
        </div>
      </div>
      <output className="slider-value" htmlFor={id}>{value}</output>
    </div>
  );
}

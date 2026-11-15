import type { Importance } from "../lib/contract-types";

export type InterviewFactor = "daySpread" | "breaks";

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

export function importanceFactor(questionId: string): InterviewFactor | undefined {
  return Object.hasOwn(QUESTION_FACTORS, questionId) ? QUESTION_FACTORS[questionId] : undefined;
}

/** The slider-only follow-up question asked right after a factor's topic question. */
export function importancePrompt(factor: InterviewFactor): string {
  return factor === "daySpread" ? "How important is matching your week layout?" : "How important is matching your breaks and longest-gap preferences?";
}

/**
 * The history indexes whose answers are followed by an importance step: the first
 * answered topic for each factor, so a factor shared by two topics is asked once.
 */
export function importanceFollowupIndexes(questionIds: string[]): number[] {
  const seen = new Set<InterviewFactor>();
  const out: number[] = [];
  questionIds.forEach((id, i) => {
    const factor = importanceFactor(id);
    if (factor && !seen.has(factor)) {
      seen.add(factor);
      out.push(i);
    }
  });
  return out;
}

export function InterviewImportance({ questionId, importance, onImportance, showHelp = true }: {
  questionId: string;
  importance: Importance;
  onImportance: (importance: Importance) => void;
  /** False when the surrounding question already asks the help text. */
  showHelp?: boolean;
}) {
  const factor = importanceFactor(questionId);
  if (!factor) return null;
  const value = importance[factor];
  const id = `interview-importance-${factor}`;
  return (
    <div className="slider-row slider-contextual">
      <div className="slider-label">
        <label htmlFor={id}>{factor === "daySpread" ? "Week layout importance" : "Breaks and gaps importance"}</label>
        {showHelp && (
          <span className="muted small" id={`${id}-help`}>
            {importancePrompt(factor)}
          </span>
        )}
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
          aria-describedby={showHelp ? `${id}-help` : undefined}
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

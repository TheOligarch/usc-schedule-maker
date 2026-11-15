import type { TermRef } from "../lib/contract-types";
import { freshnessLine } from "../lib/time";
import type { DataSource } from "../lib/termData";
import { Card, Icon } from "./ui";

export function TermPicker({ terms, termCode, source, onTerm }: { terms: TermRef[]; termCode: string | null; source: DataSource | null; onTerm: (code: string) => void }) {
  return (
    <Card title="Term" subtitle={source === "sample" ? "Live course data has not been published yet, so a sample term is shown." : "Course data comes from the USC Schedule of Classes."}>
      <div className="term-picker" role="radiogroup" aria-label="Term">
        {terms.map((t) => (
          <button key={t.code} type="button" role="radio" aria-checked={t.code === termCode} className={`term-option ${t.code === termCode ? "on" : ""}`} onClick={() => onTerm(t.code)}>
            <Icon name="calendar" />
            <span>
              <strong>{t.name}</strong>
              <span className="muted small">{freshnessLine(t.scrapedAt, { sample: source === "sample" })}</span>
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

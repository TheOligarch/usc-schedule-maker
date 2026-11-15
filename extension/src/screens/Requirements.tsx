import { useMemo, useState, type ReactNode } from "react";
import type { TermData } from "../lib/contract-types";
import { geCategories, geLabel, geShort, unitsLabel } from "../lib/schedule";
import { allowedTimes, newSlotId, type AppState, type SlotDef, type TimesState } from "../state";
import { CourseSearch } from "../components/CourseSearch";
import { TimeGrid } from "../components/TimeGrid";
import { Card, Icon, Notice, StepFooter } from "../components/ui";

/** AdviseUSC course plan, so students can check what they still need while adding courses. */
const COURSE_PLAN_URL = "https://uscmeyestro.my.site.com/adviseusc/s/course-plan";

interface Props {
  data: TermData;
  state: AppState;
  onChange: (patch: Partial<AppState>) => void;
  /** Rendered above the course cards (the term picker). */
  header?: ReactNode;
  onNext: () => void;
}

export function Requirements({ data, state, onChange, header, onNext }: Props) {
  const exclude = useMemo(() => new Set(state.required), [state.required]);
  const categories = useMemo(() => geCategories(data), [data]);
  const [geChoice, setGeChoice] = useState<string>(categories[0] ?? "");
  const requiredUnits = state.required.reduce((sum, code) => sum + (data.courses[code]?.units.min ?? 0), 0);
  const missing = state.required.filter((code) => !data.courses[code]);
  const overCap = state.unitCap !== null && requiredUnits > state.unitCap;
  const nothing = state.required.length === 0 && state.slots.length === 0;
  const anyDay = Object.values(allowedTimes(state.times)).some((b) => b.length > 0);
  const [capDraft, setCapDraft] = useState(String(state.unitCap ?? 18));

  const addSlot = (slot: Omit<SlotDef, "id" | "label">) => {
    const base = slot.kind === "GE" ? `${slot.geCategory ? geShort(slot.geCategory) : "GE"} course` : "Elective";
    const same = state.slots.filter((s) => s.label.startsWith(base)).length;
    onChange({ slots: [...state.slots, { ...slot, id: newSlotId(), label: same ? `${base} ${same + 1}` : base }] });
  };

  return (
    <div className="screen">
      {header}
      <div className="grid-2">
        <Card
          title="Required courses"
          subtitle="Courses that must be in every schedule. Lecture, discussion and lab sections are paired automatically."
          actions={
            <>
              {state.required.length > 0 && <span className="pill">{requiredUnits} units</span>}
              <a className="btn btn-secondary btn-sm" href={COURSE_PLAN_URL} target="_blank" rel="noopener noreferrer">
                Check course plan <Icon name="external" size={14} />
              </a>
            </>
          }
        >
          <CourseSearch data={data} exclude={exclude} label="Add a required course" onPick={(c) => onChange({ required: [...state.required, c.code] })} />
          {state.required.length === 0 ? (
            <p className="empty small">No required courses yet. Search above, e.g. "CSCI 201" or "writing".</p>
          ) : (
            <ul className="chip-list">
              {state.required.map((code) => {
                const c = data.courses[code];
                return (
                  <li key={code} className={`course-chip ${c ? "" : "missing"}`}>
                    <div>
                      <span className="code">{code}</span>
                      <span className="title">{c ? c.title : "Not offered this term"}</span>
                    </div>
                    <div className="chip-meta">
                      {c?.ge.map((g) => (
                        <span key={g} className="tag tag-gold">
                          {geShort(g)}
                        </span>
                      ))}
                      {c && <span className="units">{unitsLabel(c.units)} u</span>}
                      <button type="button" className="icon-btn" aria-label={`Remove ${code}`} onClick={() => onChange({ required: state.required.filter((x) => x !== code) })}>
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {missing.length > 0 && <Notice tone="warn">{missing.join(", ")} is not offered this term and will block every schedule. Remove it or pick another term.</Notice>}
        </Card>

        <Card title="GE and elective slots" subtitle="Add a GE category or elective you still need. The interview asks about your interests and suggests up to five real courses per slot. Edit the list, then each schedule chooses one course from it.">
          <p className="muted small">Check your course plan for the requirements you need; this app does not audit your degree.</p>
          <div className="slot-adders">
            <div className="row gap-sm wrap">
              <label className="sr-only" htmlFor="ge-cat">
                GE category
              </label>
              <select id="ge-cat" value={geChoice} onChange={(e) => setGeChoice(e.target.value)} disabled={categories.length === 0}>
                {categories.map((g) => (
                  <option key={g} value={g}>
                    {geLabel(g)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!geChoice} onClick={() => addSlot({ kind: "GE", geCategory: geChoice })}>
                <Icon name="plus" size={14} /> Add GE slot
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => addSlot({ kind: "elective" })}>
                <Icon name="plus" size={14} /> Add elective slot
              </button>
            </div>
          </div>
          {state.slots.length === 0 ? (
            <p className="empty small">No open slots. Add one if you still need a GE or an elective this term.</p>
          ) : (
            <ul className="chip-list">
              {state.slots.map((slot) => (
                <li key={slot.id} className="course-chip slot-chip">
                  <div>
                    <span className="code">
                      <Icon name="sparkle" size={14} /> {slot.label}
                    </span>
                    <span className="title">{slot.kind === "GE" ? geLabel(slot.geCategory ?? "") : "Any course that fits your interests"}</span>
                  </div>
                  <button type="button" className="icon-btn" aria-label={`Remove ${slot.label}`} onClick={() => onChange({ slots: state.slots.filter((s) => s.id !== slot.id) })}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Unit cap">
        <div className="field">
          <label className="sr-only" htmlFor="unit-cap">Unit cap</label>
          <div className="row gap-sm">
            <input
              id="unit-cap"
              type="number"
              min={1}
              max={30}
              step={1}
              inputMode="numeric"
              value={state.unitCap === null ? "" : capDraft}
              disabled={state.unitCap === null}
              onChange={(e) => {
                setCapDraft(e.target.value);
                const n = Math.round(Number(e.target.value));
                if (e.target.value !== "" && n >= 1 && n <= 30) onChange({ unitCap: n });
              }}
              onBlur={() => setCapDraft(String(state.unitCap ?? 18))}
            />
            <label className="check">
              <input type="checkbox" checked={state.unitCap === null} onChange={(e) => {
                  const next = e.target.checked ? null : Number(capDraft) || 18;
                  onChange({ unitCap: next });
                }} />
              No cap
            </label>
          </div>
          <span className="muted small">Variable-unit courses count their minimum.</span>
          <p className="muted small">
            Standard undergraduate tuition covers 12–18 units; units over 18 generally cost extra. Program rules and exceptions may apply.{" "}
            <a href="https://dornsife.usc.edu/advising/wp-content/uploads/sites/96/2026/04/Discover-Dornsife-Crafting-Your-Course-Plan.pdf#page=7" target="_blank" rel="noopener noreferrer">USC Courseload Policy</a>
          </p>
          {overCap && <span className="error-text small">Your required courses already add up to {requiredUnits} units.</span>}
        </div>
      </Card>

      <Card title="When can you take classes?">
        <TimeGrid times={state.times} onChange={(times: TimesState) => onChange({ times })} />
        {!anyDay && <Notice tone="warn">Every day is blocked, so no schedule can fit. Drag on the calendar to allow some time.</Notice>}
      </Card>

      <StepFooter
        next={
          <>
            {nothing && <span className="muted small footer-hint">Add a course or a slot to continue</span>}
            <button type="button" className="btn btn-primary" disabled={nothing} onClick={onNext}>
              Next: priorities <Icon name="arrowRight" />
            </button>
          </>
        }
      />
    </div>
  );
}

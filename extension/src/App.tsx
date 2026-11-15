import { useCallback, useEffect, useState } from "react";
import { AI_IS_MOCK } from "./lib/ai";
import { USE_MOCKS } from "./lib/config";
import type { TermData } from "./lib/contract-types";
import { loadTermData, loadTermIndex, type DataSource, type LoadedIndex } from "./lib/termData";
import { relativeTime } from "./lib/time";
import { defaultState, loadState, saveState, STEPS, type AppState, type StepId } from "./state";
import { Icon, Notice, Spinner, Stepper } from "./components/ui";
import { TermPicker } from "./components/TermPicker";
import { Priorities } from "./screens/Priorities";
import { Requirements } from "./screens/Requirements";
import { Interview } from "./screens/Interview";
import { Results } from "./screens/Results";

interface LoadedTerm {
  code: string;
  data: TermData;
  source: DataSource;
}

export function App({ embedded }: { embedded: boolean }) {
  const [state, setState] = useState<AppState>(loadState);
  const [index, setIndex] = useState<LoadedIndex | null>(null);
  const [term, setTerm] = useState<LoadedTerm | null>(null);
  const [termError, setTermError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => saveState(state), [state]);

  const update = useCallback((patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch })), []);

  useEffect(() => {
    let cancelled = false;
    void loadTermIndex().then((loaded) => {
      if (cancelled) return;
      setIndex(loaded);
      setState((s) => (s.termCode && loaded.index.terms.some((t) => t.code === s.termCode) ? s : { ...s, termCode: loaded.index.terms[0]?.code ?? null }));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!index || !state.termCode) return;
    const ref = index.index.terms.find((t) => t.code === state.termCode);
    if (!ref) return;
    let cancelled = false;
    setTermError(null);
    loadTermData(ref, index.source).then(
      (res) => {
        if (!cancelled) setTerm({ code: ref.code, ...res });
      },
      (err: unknown) => {
        if (!cancelled) setTermError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [index, state.termCode]);

  const data = term && term.code === state.termCode ? term.data : null;
  const hasCourses = state.required.length + state.slots.length > 0;
  const canVisit = (id: StepId): boolean => {
    if (id === "requirements") return true;
    if (!data) return false;
    if (id === "priorities" || id === "interview") return hasCourses;
    return hasCourses && state.interview !== null;
  };
  const go = (step: StepId) => {
    if (!canVisit(step)) return;
    update({ step });
    window.scrollTo({ top: 0 });
  };
  const step = canVisit(state.step) ? state.step : "requirements";

  const changeTerm = (code: string) => {
    if (code === state.termCode) return;
    // Courses differ by term, so a term switch starts the course choices over.
    update({ termCode: code, required: [], slots: [], history: [], importanceFollowup: null, interview: null, interviewFor: null });
  };

  const startOver = () => {
    if (!window.confirm("Start over? This clears your courses, times and interview answers.")) return;
    setState({ ...defaultState(), termCode: state.termCode });
  };

  const source = data ? term!.source : (index?.source ?? null);

  return (
    <div className={`app ${embedded ? "is-embedded" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="calendar" size={18} />
          </span>
          <span className="brand-text">
            <strong>Schedule Maker</strong>
            <span>Builds and ranks course schedules by what you actually want</span>
          </span>
        </div>
        <div className="topbar-right">
          {data && (
            <span className={`data-badge data-${source}`} title={source === "sample" ? "Live data is not published yet" : `Scraped ${data.term.scrapedAt}`}>
              <span className="dot" aria-hidden="true" />
              {data.term.name} · {source === "sample" ? "sample data" : `${source === "cached" ? "saved copy, " : ""}updated ${relativeTime(data.term.scrapedAt)}`}
            </span>
          )}
          {(USE_MOCKS || AI_IS_MOCK) && <span className="data-badge data-demo">demo mode</span>}
          <button type="button" className="btn btn-topbar btn-sm" onClick={startOver}>
            Start over
          </button>
        </div>
      </header>

      <Stepper current={step} canVisit={canVisit} onVisit={go} />

      <main className="content" id="main">
        {index?.note && index.source === "cached" && step === "requirements" && <Notice tone="warn">{index.note}</Notice>}
        {termError && (
          <Notice
            tone="error"
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
                <Icon name="refresh" size={14} /> Retry
              </button>
            }
          >
            {termError}
          </Notice>
        )}
        {!index && <Spinner label="Loading terms..." />}

        {index && step === "requirements" &&
          (() => {
            const picker = <TermPicker terms={index.index.terms} termCode={state.termCode} source={source} onTerm={changeTerm} />;
            return data ? (
              <Requirements data={data} state={state} onChange={update} header={picker} onNext={() => go("priorities")} />
            ) : (
              <div className="screen">
                {picker}
                {!termError && <Spinner label="Loading course data..." />}
              </div>
            );
          })()}
        {data && step === "priorities" && <Priorities importance={state.importance} onImportance={(importance) => update({ importance })} onBack={() => go("requirements")} onNext={() => go("interview")} />}
        {data && step === "interview" && <Interview data={data} sampleData={term?.source === "sample"} state={state} onChange={update} onBack={() => go("priorities")} onNext={() => go("results")} />}
        {data && step === "results" && <Results data={data} state={state} onChange={update} onEdit={go} />}
        {index && !data && step !== "requirements" && !termError && <Spinner label="Loading course data..." />}
      </main>

      <footer className="app-footer small muted">
        <span>
          Step {STEPS.findIndex((s) => s.id === step) + 1} of {STEPS.length}
        </span>
        <span>Not affiliated with USC. Always confirm sections in WebReg before registering.</span>
      </footer>
    </div>
  );
}

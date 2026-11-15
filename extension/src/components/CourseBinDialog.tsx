import { useEffect, useRef, useState } from "react";
import { binItems, prepareBin, runBinAdd, type BinItemResult, type BinRunEnd, type BinStatus, type BinTransport } from "../lib/courseBin";
import type { RankedSchedule, TermData } from "../lib/contract-types";
import { WEBREG_ORIGIN, termName, webregTermSelectUrl } from "../lib/webreg";
import { Icon, Notice, Spinner } from "./ui";

type Phase = "confirm" | "checking" | "mismatch" | "running" | "finished";

const STATUS_LABEL: Record<BinStatus, string> = {
  pending: "Not added yet",
  adding: "Adding...",
  added: "Added",
  already: "Already in bin",
  failed: "Failed",
  skipped: "Not tried",
};

interface Props {
  data: TermData;
  schedule: RankedSchedule;
  index: number;
  /** Null when the app is not running inside a WebReg tab, so nothing can be added. */
  transport: BinTransport | null;
  onClose: () => void;
}

/**
 * Confirms and then adds every section of one schedule to the student's WebReg myCourseBin,
 * one at a time, showing what happened to each. Only ever adds (see lib/courseBin.ts).
 */
export function CourseBinDialog({ data, schedule, index, transport, onClose }: Props) {
  const term = data.term.code;
  const [results, setResults] = useState<BinItemResult[]>(() => binItems(data, schedule).map((item) => ({ ...item, status: "pending", message: null })));
  const [phase, setPhase] = useState<Phase>("confirm");
  const [end, setEnd] = useState<BinRunEnd | null>(null);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = phase === "checking" || phase === "running";

  useEffect(() => {
    primaryRef.current?.focus();
  }, [phase]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const start = async () => {
    if (!transport) return;
    const items = results.map(({ courseCode, sectionId, typeLabel }) => ({ courseCode, sectionId, typeLabel }));
    setEnd(null);
    setPhase("checking");
    const prep = await prepareBin(transport, term, items);
    if (!prep.ok) {
      if (prep.reason === "term-mismatch") {
        setActiveTerm(prep.activeTerm);
        setPhase("mismatch");
        return;
      }
      setEnd({ kind: "stopped", reason: prep.reason, message: prep.message });
      setPhase("finished");
      return;
    }
    setPhase("running");
    const finished = await runBinAdd(transport, term, items, setResults);
    setEnd(finished);
    setPhase("finished");
  };

  const count = (s: BinStatus) => results.filter((r) => r.status === s).length;
  const courses = new Set(results.map((r) => r.courseCode)).size;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="bin-title" aria-describedby="bin-desc">
        <header className="card-head">
          <div>
            <h2 id="bin-title">
              <Icon name="plus" /> Add schedule #{index + 1} to myCourseBin
            </h2>
            <p className="muted" id="bin-desc">
              {phase === "confirm"
                ? `Adds these ${results.length} section${results.length === 1 ? "" : "s"} (${courses} course${courses === 1 ? "" : "s"}, ${termName(term)}) to your WebReg myCourseBin. It only adds: nothing is registered, dropped, checked out or removed from your bin.`
                : `${termName(term)} · ${results.length} section${results.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

        {!transport && (
          <Notice tone="warn">
            Adding to myCourseBin works from WebReg itself: sign in at{" "}
            <a href={WEBREG_ORIGIN} target="_blank" rel="noopener noreferrer">
              webreg.usc.edu
            </a>{" "}
            and open the myScheduleMaker tab there.
          </Notice>
        )}

        {phase === "mismatch" && activeTerm && (
          <Notice tone="warn">
            This schedule is for {termName(term)}, but WebReg is showing {termName(activeTerm)}, so nothing was added.{" "}
            <a href={webregTermSelectUrl(term)} target="_blank" rel="noopener noreferrer">
              switch WebReg to {termName(term)}
            </a>
            , then check again.
          </Notice>
        )}

        {end?.kind === "stopped" && (
          <Notice tone="error">
            Stopped: {end.message}
            {results.some((r) => r.status === "added" || r.status === "already") ? " The sections marked below were handled before it stopped." : ""}
          </Notice>
        )}

        {phase === "checking" && <Spinner label="Checking WebReg's term and session..." />}

        <div className="table-scroll">
          <table className="sections bin-table">
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Type</th>
                <th scope="col">Section</th>
                {phase !== "confirm" && phase !== "mismatch" && <th scope="col">Result</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.sectionId} data-status={r.status}>
                  <td>{r.courseCode}</td>
                  <td>{r.typeLabel}</td>
                  <td className="mono">{r.sectionId}</td>
                  {phase !== "confirm" && phase !== "mismatch" && (
                    <td>
                      <span className={`bin-status bin-${r.status}`}>
                        {r.status === "added" ? <Icon name="check" size={13} /> : r.status === "failed" ? <Icon name="alert" size={13} /> : null} {STATUS_LABEL[r.status]}
                      </span>
                      {r.message && r.status !== "added" && <div className="muted small bin-message">{r.message}</div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {phase === "finished" && end?.kind === "done" && (
          <p className="small bin-summary" role="status">
            Added {count("added")}
            {count("already") ? `, ${count("already")} already in your bin` : ""}
            {count("failed") ? `, ${count("failed")} failed` : ""}.{" "}
            <a href={`${WEBREG_ORIGIN}/CourseBin`} target="_blank" rel="noopener noreferrer">
              Open myCourseBin <Icon name="external" size={12} />
            </a>
          </p>
        )}

        <footer className="modal-foot">
          {phase === "confirm" && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button ref={primaryRef} type="button" className="btn btn-primary btn-sm" onClick={() => void start()} disabled={!transport || results.length === 0}>
                Add {results.length} section{results.length === 1 ? "" : "s"}
              </button>
            </>
          )}
          {phase === "mismatch" && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button ref={primaryRef} type="button" className="btn btn-primary btn-sm" onClick={() => void start()}>
                <Icon name="refresh" size={14} /> Check again
              </button>
            </>
          )}
          {phase === "running" && <Spinner label={`Adding section ${Math.min(results.length, count("added") + count("already") + count("failed") + 1)} of ${results.length}...`} />}
          {phase === "finished" && (
            <button ref={primaryRef} type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

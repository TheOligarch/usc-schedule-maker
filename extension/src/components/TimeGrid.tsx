import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Block, Day } from "../lib/contract-types";
import { DAYS, DAY_LONG, fmtBlocks, fmtTime, normalizeBlocks, subtractBlocks, toHHMM, toMin } from "../lib/time";
import { blocksFor, isWeekend, type TimesState } from "../state";
import { Icon } from "./ui";

export const GRID_START = 7 * 60;
export const GRID_END = 22 * 60;
const SNAP = 30;
const PX_PER_HOUR = 34;
const PX_PER_MIN = PX_PER_HOUR / 60;
const HEIGHT = (GRID_END - GRID_START) * PX_PER_MIN;
const HOURS = Array.from({ length: (GRID_END - GRID_START) / 60 + 1 }, (_, i) => GRID_START + i * 60);
const TIME_OPTIONS = Array.from({ length: (GRID_END - GRID_START) / SNAP + 1 }, (_, i) => toHHMM(GRID_START + i * SNAP));

type ColumnKey = "global" | Day;

interface Drag {
  col: ColumnKey;
  mode: "paint" | "erase";
  anchor: number;
  current: number;
}

function snap(min: number): number {
  return Math.max(GRID_START, Math.min(GRID_END - SNAP, Math.floor(min / SNAP) * SNAP));
}

function applyDrag(blocks: Block[], drag: Drag): Block[] {
  const start = toHHMM(Math.min(drag.anchor, drag.current));
  const end = toHHMM(Math.max(drag.anchor, drag.current) + SNAP);
  return drag.mode === "paint" ? normalizeBlocks([...blocks, { start, end }]) : subtractBlocks(blocks, start, end);
}

function inside(blocks: Block[], min: number): boolean {
  return blocks.some((b) => toMin(b.start) <= min && min < toMin(b.end));
}

interface Props {
  times: TimesState;
  onChange: (next: TimesState) => void;
}

/**
 * Allowed-times editor. Click and drag on empty space to add an allowed block, drag
 * across an existing block to erase part of it. The "Every day" column is the global
 * default that every day inherits until it is edited on its own; an empty day is a day off.
 */
export function TimeGrid({ times, onChange }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const bodyRefs = useRef(new Map<ColumnKey, HTMLDivElement>());
  const days = DAYS.filter((d) => times.weekends || !isWeekend(d));
  const columns: { key: ColumnKey; label: string; blocks: Block[]; inherited: boolean }[] = [
    { key: "global", label: "Every day", blocks: times.global, inherited: false },
    ...days.map((d) => ({ key: d as ColumnKey, label: d, blocks: blocksFor(times, d), inherited: !times.overrides[d] })),
  ];

  const setColumn = (key: ColumnKey, blocks: Block[]) => {
    if (key === "global") onChange({ ...times, global: normalizeBlocks(blocks) });
    else onChange({ ...times, overrides: { ...times.overrides, [key]: normalizeBlocks(blocks) } });
  };
  const resetDay = (day: Day) => {
    const overrides = { ...times.overrides };
    delete overrides[day];
    onChange({ ...times, overrides });
  };

  const minuteAt = (key: ColumnKey, clientY: number) => {
    const el = bodyRefs.current.get(key);
    if (!el) return GRID_START;
    return snap(GRID_START + (clientY - el.getBoundingClientRect().top) / PX_PER_MIN);
  };

  const onPointerDown = (key: ColumnKey, blocks: Block[], e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const min = minuteAt(key, e.clientY);
    setDrag({ col: key, mode: inside(blocks, min) ? "erase" : "paint", anchor: min, current: min });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const min = minuteAt(drag.col, e.clientY);
    if (min !== drag.current) setDrag({ ...drag, current: min });
  };
  const onPointerUp = (blocks: Block[]) => {
    if (!drag) return;
    setColumn(drag.col, applyDrag(blocks, drag));
    setDrag(null);
  };

  return (
    <div className="timegrid-wrap">
      <div className="timegrid-toolbar">
        <p className="muted small">
          <strong>Click and drag</strong> to mark when classes are allowed. Drag over a block to erase part of it. Edit <em>Every day</em> to change all days at once, or edit a
          single day to override it. A day with no blocks is a day off.
        </p>
        <div className="row gap-sm">
          <label className="check">
            <input type="checkbox" checked={times.weekends} onChange={(e) => onChange({ ...times, weekends: e.target.checked })} />
            Weekends
          </label>
          <button type="button" className="btn btn-ghost btn-sm" disabled={Object.keys(times.overrides).length === 0} onClick={() => onChange({ ...times, overrides: {} })}>
            <Icon name="undo" /> Reset all days to default
          </button>
        </div>
      </div>

      <div className="timegrid" role="group" aria-label="Allowed class times" style={{ ["--cols" as string]: columns.length }}>
        <div className="tg-head tg-corner" aria-hidden="true" />
        {columns.map((col) => {
          const status = col.key === "global" ? "Default" : col.inherited ? "Default" : col.blocks.length === 0 ? "Day off" : "Custom";
          return (
            <div key={col.key} className={`tg-head ${col.key === "global" ? "tg-head-global" : ""}`}>
              <span className="tg-day">{col.label}</span>
              {col.key === "global" ? (
                <span className="tg-status">applies to all</span>
              ) : (
                <span className={`tg-status tg-status-${status.replace(" ", "").toLowerCase()}`}>{status}</span>
              )}
              {col.key !== "global" && (
                <span className="tg-actions">
                  {!col.inherited ? (
                    <button type="button" className="link-btn" onClick={() => resetDay(col.key as Day)} aria-label={`Reset ${DAY_LONG[col.key as Day]} to the default`}>
                      reset
                    </button>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => setColumn(col.key, [])} aria-label={`Make ${DAY_LONG[col.key as Day]} a day off`}>
                      day off
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}

        <div className="tg-hours" aria-hidden="true" style={{ height: HEIGHT }}>
          {HOURS.map((h) => (
            <span key={h} style={{ top: (h - GRID_START) * PX_PER_MIN }}>
              {fmtTime(h, true)}
            </span>
          ))}
        </div>
        {columns.map((col) => {
          const shown = drag && drag.col === col.key ? applyDrag(col.blocks, drag) : col.blocks;
          const name = col.key === "global" ? "every day" : DAY_LONG[col.key as Day];
          return (
            <div
              key={col.key}
              ref={(el) => {
                if (el) bodyRefs.current.set(col.key, el);
                else bodyRefs.current.delete(col.key);
              }}
              className={`tg-col ${col.key === "global" ? "tg-col-global" : ""} ${col.inherited && col.key !== "global" ? "tg-col-inherited" : ""} ${drag?.col === col.key ? `tg-dragging tg-${drag.mode}` : ""}`}
              style={{ height: HEIGHT }}
              onPointerDown={(e) => onPointerDown(col.key, col.blocks, e)}
              onPointerMove={onPointerMove}
              onPointerUp={() => onPointerUp(col.blocks)}
              onPointerCancel={() => setDrag(null)}
              aria-label={`Allowed times ${name}: ${fmtBlocks(col.blocks)}`}
              role="img"
            >
              {HOURS.slice(1, -1).map((h) => (
                <span key={h} className="tg-line" style={{ top: (h - GRID_START) * PX_PER_MIN }} />
              ))}
              {shown.length === 0 && col.key !== "global" && <span className="tg-off">Day off</span>}
              {shown.map((b) => {
                const s = Math.max(GRID_START, toMin(b.start));
                const e = Math.min(GRID_END, toMin(b.end));
                if (e <= s) return null;
                return (
                  <div key={`${b.start}-${b.end}`} className="tg-block" style={{ top: (s - GRID_START) * PX_PER_MIN, height: (e - s) * PX_PER_MIN }}>
                    <span className="tg-block-label">
                      {fmtTime(b.start, true)}
                      <br />
                      {fmtTime(b.end, true)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <details className="tg-list">
        <summary>Edit times as a list (keyboard friendly)</summary>
        <div className="tg-list-body">
          {columns.map((col) => (
            <BlockListRow
              key={col.key}
              label={col.key === "global" ? "Every day (default)" : DAY_LONG[col.key as Day]}
              blocks={col.blocks}
              inherited={col.inherited && col.key !== "global"}
              onChange={(blocks) => setColumn(col.key, blocks)}
              onReset={col.key !== "global" && !col.inherited ? () => resetDay(col.key as Day) : undefined}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function BlockListRow({ label, blocks, inherited, onChange, onReset }: { label: string; blocks: Block[]; inherited: boolean; onChange: (b: Block[]) => void; onReset?: () => void }) {
  // Keep a block valid while editing: moving one edge past the other drags it along.
  const edit = (i: number, patch: Partial<Block>) =>
    onChange(
      blocks.map((b, j) => {
        if (j !== i) return b;
        const next = { ...b, ...patch };
        if (toMin(next.end) <= toMin(next.start)) {
          if (patch.start) next.end = toHHMM(Math.min(GRID_END, toMin(next.start) + SNAP));
          else next.start = toHHMM(Math.max(GRID_START, toMin(next.end) - SNAP));
        }
        return next;
      }),
    );
  return (
    <div className="tg-list-row">
      <div className="tg-list-label">
        <strong>{label}</strong>
        {inherited && <span className="muted small"> (uses default)</span>}
      </div>
      <div className="tg-list-blocks">
        {blocks.length === 0 && <span className="muted small">Day off</span>}
        {blocks.map((b, i) => (
          <span key={i} className="tg-list-block">
            <select aria-label={`${label} block ${i + 1} start`} value={b.start} onChange={(e) => edit(i, { start: e.target.value })}>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {fmtTime(t)}
                </option>
              ))}
            </select>
            <span aria-hidden="true">to</span>
            <select aria-label={`${label} block ${i + 1} end`} value={b.end} onChange={(e) => edit(i, { end: e.target.value })}>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {fmtTime(t)}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label={`Remove ${label} block ${i + 1}`} onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...blocks, { start: "09:00", end: "12:00" }])}>
          <Icon name="plus" size={14} /> Add block
        </button>
        {onReset && (
          <button type="button" className="link-btn small" onClick={onReset}>
            reset to default
          </button>
        )}
      </div>
    </div>
  );
}

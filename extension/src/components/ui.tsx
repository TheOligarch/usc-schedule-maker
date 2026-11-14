import type { ReactNode } from "react";
import { STEPS, type StepId } from "../state";

const ICON_PATHS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  sparkle: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 5v6h-6",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  calendar: "M4 9h16M8 3v4M16 3v4M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  info: "M12 11v6M12 7.5v.5M12 21a9 9 0 100-18 9 9 0 000 18z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function Stepper({ current, canVisit, onVisit }: { current: StepId; canVisit: (id: StepId) => boolean; onVisit: (id: StepId) => void }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <nav className="stepper" aria-label="Progress">
      <ol>
        {STEPS.map((step, i) => {
          const status = i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          const enabled = canVisit(step.id);
          return (
            <li key={step.id} className={`step step-${status}`}>
              <button type="button" disabled={!enabled} aria-current={status === "current" ? "step" : undefined} onClick={() => onVisit(step.id)}>
                <span className="step-num">{status === "done" ? <Icon name="check" size={14} /> : i + 1}</span>
                <span className="step-text">
                  <span className="step-label">{step.label}</span>
                  <span className="step-hint">{step.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "warn" | "error"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "info" ? "info" : "alert"} />
      <div className="notice-body">{children}</div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function StepFooter({ back, next }: { back?: ReactNode; next?: ReactNode }) {
  return (
    <footer className="step-footer">
      <div>{back}</div>
      <div>{next}</div>
    </footer>
  );
}

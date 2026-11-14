import { useId, useMemo, useRef, useState } from "react";
import type { Course, TermData } from "../lib/contract-types";
import { geShort, unitsLabel } from "../lib/schedule";
import { Icon } from "./ui";

const MAX_RESULTS = 8;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Rank courses for a query: code prefix first, then code substring, then title words. */
export function searchCourses(data: TermData, query: string, exclude: Set<string>, filter?: (c: Course) => boolean): Course[] {
  const q = norm(query);
  if (!q) return [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { c: Course; score: number }[] = [];
  for (const c of Object.values(data.courses)) {
    if (exclude.has(c.code) || (filter && !filter(c))) continue;
    const code = norm(c.code);
    const title = c.title.toLowerCase();
    let score = 0;
    if (code === q) score = 100;
    else if (code.startsWith(q)) score = 80;
    else if (code.includes(q)) score = 60;
    else if (words.every((w) => title.includes(w))) score = 40;
    else if (words.every((w) => `${title} ${(c.description ?? "").toLowerCase()}`.includes(w))) score = 15;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code));
  return scored.slice(0, MAX_RESULTS).map((x) => x.c);
}

interface Props {
  data: TermData;
  exclude: Set<string>;
  onPick: (course: Course) => void;
  label: string;
  placeholder?: string;
  filter?: (c: Course) => boolean;
  disabled?: boolean;
}

/** Accessible combobox (WAI-ARIA 1.2 pattern) over the term's courses. */
export function CourseSearch({ data, exclude, onPick, label, placeholder, filter, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCourses(data, query, exclude, filter), [data, query, exclude, filter]);
  const showList = open && query.trim().length > 0;

  const pick = (course: Course) => {
    onPick(course);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="course-search">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="search-box">
        <Icon name="search" />
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${results[active].code}` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder ?? "Search by code or title, e.g. CSCI 201"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && showList && results[active]) {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {showList && (
        <ul className="search-results" id={listId} role="listbox" aria-label={label}>
          {results.length === 0 && <li className="search-empty">No courses match "{query.trim()}" this term.</li>}
          {results.map((c, i) => (
            <li
              key={c.code}
              id={`${listId}-${c.code}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="code">{c.code}</span>
              <span className="title">{c.title}</span>
              <span className="meta">
                {c.ge.map((g) => (
                  <span key={g} className="tag tag-gold">
                    {geShort(g)}
                  </span>
                ))}
                <span className="units">{unitsLabel(c.units)} units</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

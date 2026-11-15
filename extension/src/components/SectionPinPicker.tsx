import type { Section, TermData } from "../lib/contract-types";
import { instructorNames } from "../lib/schedule";
import { pinView, setComponentPin } from "../lib/sectionPins";
import { fmtMeeting } from "../lib/time";
import { Icon } from "./ui";

const brief = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function optionText(s: Section): string {
  const when = s.meetings.map((m) => fmtMeeting(m)).join("; ") || (s.online ? "Online" : "Time TBA");
  return `${s.id} · ${when} · ${instructorNames(s)}${s.notes ? ` · ${brief(s.notes)}` : ""}`;
}

/**
 * Optional section pins for one required course: one picker per component (lecture, lab,
 * discussion, quiz). Each picker only offers sections that form a registrable linked
 * combination with the other pins, so dependent options fill in as soon as one is chosen.
 */
export function SectionPinPicker({ data, code, pins, onPins }: { data: TermData; code: string; pins: string[]; onPins: (pins: string[]) => void }) {
  const view = pinView(data, code, pins);
  if (!view.groups.length && !view.stale.length) return null;
  const notes = pins.map((id) => data.sections[id]).filter((s): s is Section => Boolean(s?.notes));
  return (
    <fieldset className="field section-pin">
      <legend>Require specific sections (optional)</legend>
      {view.unlinkable && <p className="small error-text">USC does not publish which of this course’s components go together, so no section combination can be verified.</p>}
      {view.groups.map((g) => {
        const id = g.group === "lecture" ? `pin-${code}` : `pin-${code}-${g.group.toLowerCase()}`;
        const pinned = g.pinned ? data.sections[g.pinned] : null;
        return (
          <div key={g.group} className="pin-row">
            <label htmlFor={id}>{g.label}</label>
            <select id={id} value={g.pinned ?? ""} onChange={(e) => onPins(setComponentPin(data, code, pins, g.group, e.target.value || null))}>
              <option value="">Any {g.label.toLowerCase()}{g.options.length ? ` (${g.options.length} option${g.options.length === 1 ? "" : "s"})` : ""}</option>
              {g.options.map((s) => (
                <option key={s.id} value={s.id}>
                  {optionText(s)}
                </option>
              ))}
            </select>
            {pinned && (
              <span className="pin-chip">
                <span className="pin-chip-text">Pinned {g.label.toLowerCase()} {pinned.id}</span>
                <button type="button" className="pin-clear" aria-label={`Clear pinned ${g.label.toLowerCase()} section ${pinned.id} for ${code}`} title="Clear this section pin (keeps the course)" onClick={() => onPins(setComponentPin(data, code, pins, g.group, null))}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
          </div>
        );
      })}
      {view.stale.map((id) => (
        <span key={id} className="pin-chip pin-chip-stale">
          <span className="pin-chip-text">Section {id} is no longer offered</span>
          <button type="button" className="pin-clear" aria-label={`Clear unavailable pinned section ${id} for ${code}`} title="Clear this section pin (keeps the course)" onClick={() => onPins(pins.filter((p) => p !== id))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      {!view.valid && !view.stale.length && pins.length > 0 && <p className="small error-text">These pinned sections are not a registrable combination. Clear one of them.</p>}
      {notes.map((s) => (
        <p key={s.id} className="small">
          {s.id}: {s.notes}
        </p>
      ))}
    </fieldset>
  );
}

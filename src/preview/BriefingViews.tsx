// Briefing frame renderers (issue #91, spec #86 D9): BriefingHeader,
// SectionHeader, ThreadUpdate, SkipList, DoneMarker. Presentation lives in
// `.aur-digest-*` classes in src/styles.css — no inline styles, no network I/O.
import { Icon } from "./DigestCardView";
import { useExpanded } from "./expandState";

export interface Pass {
  time: string;
  label: string;
  state: "done" | "running" | "queued";
}

const PASS_ICON = { done: "checkCircle", running: "clock", queued: "circle" } as const;

export function BriefingHeaderView(p: {
  date: string;
  scanned: number;
  kept: number;
  minutes?: number;
  live?: boolean;
  kicker?: string;
  passes?: Pass[];
}) {
  return (
    <header className="aur-digest-header">
      <div className="aur-digest-header__top">
        <div className="aur-digest-header__id">
          <div className="aur-digest-header__kicker">{p.kicker ?? "Daily briefing"}</div>
          <h1 className="aur-digest-header__date">{p.date}</h1>
        </div>
        <div className="aur-digest-header__stats">
          <div className="aur-digest-header__stat">
            <span className="aur-digest-header__num">{p.scanned}</span>
            <span className="aur-digest-header__unit">scanned</span>
          </div>
          <span className="aur-digest-header__sep" />
          <div className="aur-digest-header__stat">
            <span className="aur-digest-header__num is-kept">{p.kept}</span>
            <span className="aur-digest-header__unit">kept</span>
          </div>
          {p.minutes !== undefined && (
            <>
              <span className="aur-digest-header__sep" />
              <div className="aur-digest-header__stat">
                <span className="aur-digest-header__num">{p.minutes}</span>
                <span className="aur-digest-header__unit">min</span>
              </div>
            </>
          )}
          {p.live && (
            <span className="aur-digest-header__live">
              <span className="aur-digest-header__dot" /> Live
            </span>
          )}
        </div>
      </div>
      {p.passes && p.passes.length > 0 && (
        <div className="aur-digest-header__passes">
          {p.passes.map((pass, i) => (
            <div key={i} className={`aur-digest-header__pass is-${pass.state}`}>
              <Icon name={PASS_ICON[pass.state]} size={13} className="aur-digest-header__passicon" />
              <span className="aur-digest-header__passtime">{pass.time}</span>
              <span className="aur-digest-header__passlabel">{pass.label}</span>
            </div>
          ))}
          <span>one UI artifact · patched in place</span>
        </div>
      )}
    </header>
  );
}

export function SectionHeaderView(p: { label: string; note?: string }) {
  return (
    <div className="aur-digest-section">
      <span className="aur-digest-section__label">{p.label}</span>
      <span className="aur-digest-section__rule" />
      {p.note && <span className="aur-digest-section__note">{p.note}</span>}
    </div>
  );
}

export function ThreadUpdateView(p: {
  thread_id: string;
  title: string;
  update: string;
  day?: string;
  history?: { when: string; text: string }[];
}) {
  return (
    <article className="aur-digest-thread">
      <div className="aur-digest-thread__head">
        <Icon name="thread" size={15} className="aur-digest-thread__icon" />
        <span className="aur-digest-thread__title">{p.title}</span>
        {p.day && <span className="aur-digest-thread__day">{p.day}</span>}
        <span className="aur-digest__spacer" />
        <button
          type="button"
          className="aur-digest__id"
          title={`Copy handle for chat: ${p.thread_id}`}
          onClick={() => navigator.clipboard?.writeText(p.thread_id).catch(() => {})}
        >
          {p.thread_id}
        </button>
      </div>
      <div className="aur-digest-thread__update">{p.update}</div>
      {p.history && p.history.length > 0 && (
        <div className="aur-digest-thread__history">
          {p.history.map((h, i) => (
            <div key={i} className="aur-digest-thread__hrow">
              <span className="aur-digest-thread__when">{h.when}</span>
              <span>{h.text}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** Fixed expand key: one skip list per program, collapsed by default. */
export const SKIPLIST_KEY = "skiplist";

export function SkipListView(p: { count: number; items: { title: string; reason: string }[] }) {
  const [open, toggle] = useExpanded(SKIPLIST_KEY);
  const hidden = p.count - p.items.length;
  const expandable = p.items.length > 0;
  const isOpen = expandable && open;
  return (
    <div className={`aur-digest-skips${isOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="aur-digest-skips__toggle"
        aria-expanded={isOpen}
        disabled={!expandable}
        onClick={toggle}
      >
        <Icon name={isOpen ? "down" : "right"} size={16} className="aur-digest__chev" />
        <span className="aur-digest-skips__title">Skipped {p.count}</span>
        <span className="aur-digest-skips__hint">one-line reasons</span>
        <span className="aur-digest__spacer" />
        {expandable && <span className="aur-digest-skips__action">{isOpen ? "Hide" : "Show reasons"}</span>}
      </button>
      {isOpen && (
        <div className="aur-digest-skips__list">
          {p.items.map((it, i) => (
            <div key={i} className="aur-digest-skips__row">
              <span className="aur-digest-skips__item">{it.title}</span>
              <span className="aur-digest-skips__reason">{it.reason}</span>
            </div>
          ))}
          {hidden > 0 && (
            <div className="aur-digest-skips__row">
              <span className="aur-digest-skips__item">{hidden} more</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DoneMarkerView(p: { title: string; text?: string }) {
  return (
    <div className="aur-digest-done">
      <Icon name="checkCircle" size={28} className="aur-digest-done__icon" />
      <div className="aur-digest-done__title">{p.title}</div>
      {p.text && <div className="aur-digest-done__text">{p.text}</div>}
    </div>
  );
}

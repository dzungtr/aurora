// DigestCard renderer (issue #90, spec #86 D6/D7): one kept story, three
// weights (hero / rail / list). Presentation lives in `.aur-digest*` classes
// in src/styles.css — no inline styles. Expand/collapse is client-only state.
import type { ReactNode } from "react";
import { useExpanded } from "./expandState";

const GLYPHS = {
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  right: "M9 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  why: "M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM5 20a7 7 0 0 1 14 0M16 17l2 2 3-3",
} as const;

/** Inline SVG glyph — bundled with the page so expand/collapse never triggers an icon fetch. */
function Icon({ name, size = 14, className }: { name: keyof typeof GLYPHS; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}

export interface DigestCardViewProps {
  story_id: string;
  variant: "hero" | "rail" | "list";
  title: string;
  source: string;
  lang: string;
  minutes: number;
  sapo: string;
  why: string;
  body?: string;
  url?: string;
  /** Pre-rendered child nodes (Text / Chart / Mermaid) from the OpenUI renderer. */
  children?: ReactNode;
  hasChildren: boolean;
}

/** Body paragraphs: split on blank lines, trimmed, empties dropped. */
export function splitParagraphs(body: string | undefined): string[] {
  return (body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function DigestCardView(p: DigestCardViewProps) {
  const [open, toggle] = useExpanded(p.story_id);
  const safeUrl = p.url && p.url.startsWith("https://") ? p.url : undefined;
  const paragraphs = splitParagraphs(p.body);
  const expandable = paragraphs.length > 0 || p.hasChildren || !!safeUrl;
  const isOpen = expandable && open;
  const isList = p.variant === "list";

  const chip = (
    <button
      type="button"
      className="aur-digest__id"
      title={`Copy handle for chat: deep-read ${p.story_id}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(p.story_id).catch(() => {});
      }}
    >
      {p.story_id}
    </button>
  );

  const why = (
    <div className="aur-digest__why">
      <Icon name="why" size={p.variant === "hero" ? 15 : 13} className="aur-digest__whyicon" />
      <div>
        {p.variant !== "rail" && <span className="aur-digest__whylabel">Why you · </span>}
        {p.why}
      </div>
    </div>
  );

  const more = isOpen && (
    <div className="aur-digest__more">
      {isList && why}
      {paragraphs.length > 0 && (
        <div className="aur-digest__body">
          {paragraphs.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      )}
      {p.hasChildren && <div className="aur-digest__children">{p.children}</div>}
      {safeUrl && (
        <div className="aur-digest__srcrow">
          <a
            className="aur-digest__srclink"
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="external" size={13} /> Original source
          </a>
        </div>
      )}
    </div>
  );

  const cls = [
    "aur-digest",
    `aur-digest--${p.variant}`,
    expandable ? "is-expandable" : "",
    isOpen ? "is-open" : "",
  ].filter(Boolean).join(" ");
  const onClick = expandable ? toggle : undefined;

  if (isList) {
    return (
      <article className={cls} onClick={onClick}>
        <div className="aur-digest__row">
          {expandable && <Icon name={isOpen ? "down" : "right"} size={16} className="aur-digest__chev" />}
          <div className="aur-digest__main">
            <div className="aur-digest__headline">
              <span className="aur-digest__title">{p.title}</span>
              <span className="aur-digest__byline">{p.source} · {p.lang} · {p.minutes} min</span>
            </div>
            <div className="aur-digest__sapo">{p.sapo}</div>
            {more}
          </div>
          {chip}
        </div>
      </article>
    );
  }

  const Title = p.variant === "hero" ? "h2" : "div";
  return (
    <article className={cls} onClick={onClick}>
      <div className="aur-digest__meta">
        <span className="aur-digest__source">{p.source}</span>
        <span className="aur-digest__lang">{p.lang}</span>
        <span className="aur-digest__min">{p.minutes} min</span>
        <span className="aur-digest__spacer" />
        {chip}
      </div>
      <Title className="aur-digest__title">{p.title}</Title>
      <div className="aur-digest__sapo">{p.sapo}</div>
      {why}
      {more}
      {expandable && (
        <button type="button" className="aur-digest__toggle" aria-expanded={isOpen}>
          <Icon name={isOpen ? "up" : "down"} size={p.variant === "hero" ? 15 : 14} />
          {isOpen ? "Collapse" : "Read digest"}
        </button>
      )}
    </article>
  );
}

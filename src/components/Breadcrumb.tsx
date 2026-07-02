export interface BreadcrumbProps {
  path: string;
}

/** Slash-separated path rendered as muted crumbs with a bold final segment. */
export function Breadcrumb({ path }: BreadcrumbProps) {
  const parts = path.split("/");
  return (
    <div className="aur-crumbs">
      {parts.map((part, i) => {
        const last = i === parts.length - 1;
        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span className={`aur-crumb${last ? " is-last" : ""}`}>{part}</span>
            {!last && <span style={{ color: "var(--text-light)", opacity: .7 }}>›</span>}
          </span>
        );
      })}
    </div>
  );
}

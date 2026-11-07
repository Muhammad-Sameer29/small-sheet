import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon";
import s from "./Screens.module.css";

// Every state the grid area can be in besides "showing a sheet" uses this one layout.
export function Screen({ icon, tone, title, children, actions }: { icon: IconName; tone?: "error"; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.screen}>
      <div className={s.card}>
        <span className={[s.badge, tone === "error" && s.badgeError].filter(Boolean).join(" ")}>
          <Icon name={icon} size={20} />
        </span>
        <h2 className={s.title}>{title}</h2>
        {children && <div className={s.body}>{children}</div>}
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
    </div>
  );
}

// First load: the shape of a sheet, so nothing shifts when the real one arrives.
export function GridSkeleton() {
  return (
    <div className={s.skeleton} aria-busy="true" aria-label="Loading sheet">
      <div className={s.skHead} />
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className={s.skRow}>
          <span className={s.skNum} />
          <span className={s.skBar} style={{ width: `${18 + ((i * 37) % 22)}%` }} />
          <span className={s.skBar} style={{ width: `${8 + ((i * 53) % 9)}%` }} />
          <span className={s.skBar} style={{ width: `${8 + ((i * 29) % 7)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyHint() {
  return (
    <div className={s.empty} aria-hidden="true">
      <span className={s.emptyIcon}>
        <Icon name="grid" size={20} />
      </span>
      <p className={s.emptyTitle}>This sheet is empty</p>
      <p className={s.emptyText}>Start typing, or paste a table from anywhere.</p>
    </div>
  );
}

import { Icon } from "../ui/Icon";
import s from "./Toasts.module.css";

export interface Toast {
  id: number;
  tone: "info" | "warn";
  text: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className={s.stack} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={[s.toast, t.tone === "warn" && s.warn].filter(Boolean).join(" ")}>
          <Icon name={t.tone === "warn" ? "alert" : "check"} size={14} />
          <span>{t.text}</span>
          <button type="button" className={s.close} onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

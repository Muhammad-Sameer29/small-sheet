import { formatStat } from "@/lib/engine/values";
import type { Stats } from "@/lib/engine/engine";
import s from "./StatusBar.module.css";

// Sum and average only count numbers; count is every non-empty cell, like Excel's status bar.
export function StatusBar({ stats, mode }: { stats: Stats; mode: string }) {
  const hasNumbers = stats.numbers > 0;
  return (
    <div className={s.status} aria-label="Selection summary">
      <span className={s.mode}>{mode}</span>
      <Stat label="Sum" value={hasNumbers ? formatStat(stats.sum) : "—"} />
      <Stat label="Average" short="Avg" value={hasNumbers ? formatStat(stats.sum / stats.numbers) : "—"} />
      <Stat label="Count" value={formatStat(stats.count)} />
    </div>
  );
}

function Stat({ label, short, value }: { label: string; short?: string; value: string }) {
  return (
    <span className={s.stat}>
      <span className={s.label} aria-label={label}>
        {short ?? label}
      </span>
      <span className={s.value}>{value}</span>
    </span>
  );
}

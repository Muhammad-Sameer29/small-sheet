"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SheetMeta } from "@/lib/types";
import { MAX_NAME } from "@/lib/types";
import { Icon } from "../ui/Icon";
import s from "./SheetTabs.module.css";

interface Props {
  sheets: SheetMeta[];
  activeId: string;
  adding: boolean;
  onSelect(id: string): void;
  onAdd(): void;
  onRename(id: string, name: string): void;
}

export function SheetTabs({ sheets, activeId, adding, onSelect, onAdd, onRename }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  // Tabs follow the ARIA tabs pattern: one tab stop, arrow keys move between tabs.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number, id: string) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (i + (e.key === "ArrowRight" ? 1 : -1) + sheets.length) % sheets.length;
      tabs.current[next]?.focus();
    } else if (e.key === "F2") {
      e.preventDefault();
      setRenaming(id);
    }
  };

  return (
    <div className={s.tabs} role="tablist" aria-label="Sheets">
      {sheets.map((sheet, i) => {
        const active = sheet.id === activeId;
        if (renaming === sheet.id) {
          return (
            <RenameInput
              key={sheet.id}
              initial={sheet.name}
              taken={sheets.filter((x) => x.id !== sheet.id).map((x) => x.name.toLowerCase())}
              onDone={(name) => {
                setRenaming(null);
                if (name && name !== sheet.name) onRename(sheet.id, name);
                requestAnimationFrame(() => tabs.current[i]?.focus());
              }}
            />
          );
        }
        return (
          <button
            key={sheet.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={[s.tab, active && s.active].filter(Boolean).join(" ")}
            onClick={() => !active && onSelect(sheet.id)}
            onDoubleClick={() => setRenaming(sheet.id)}
            onKeyDown={(e) => onKey(e, i, sheet.id)}
            title={active ? "Double-click or press F2 to rename" : undefined}
          >
            {sheet.name}
          </button>
        );
      })}
      <button type="button" className={s.add} onClick={onAdd} disabled={adding} aria-label="Add a sheet" title="Add a sheet">
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

function RenameInput({ initial, taken, onDone }: { initial: string; taken: string[]; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const trimmed = value.trim();
  const problem = !trimmed ? "A sheet needs a name" : taken.includes(trimmed.toLowerCase()) ? "Another sheet already has this name" : null;

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };

  return (
    <span className={s.renameWrap}>
      <input
        ref={ref}
        className={[s.rename, problem && s.renameBad].filter(Boolean).join(" ")}
        value={value}
        maxLength={MAX_NAME}
        size={Math.max(6, value.length + 1)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!problem) finish(trimmed);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        onBlur={() => finish(problem ? null : trimmed)}
        aria-label="Sheet name"
        aria-invalid={!!problem}
        aria-describedby={problem ? "rename-problem" : undefined}
      />
      {problem && (
        <span id="rename-problem" className={s.problem} role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

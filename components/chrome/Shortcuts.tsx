"use client";

import { forwardRef } from "react";
import { Button } from "../ui/Button";
import s from "./Shortcuts.module.css";

const GROUPS: Array<[string, Array<[string, string]>]> = [
  [
    "Move",
    [
      ["Arrows", "Move one cell"],
      ["Shift + Arrows", "Extend the selection"],
      ["⌘/Ctrl + Arrows", "Jump to the edge of the data"],
      ["Tab · Shift + Tab", "Right · left"],
      ["Page Up · Page Down", "One screen"],
      ["⌘/Ctrl + Home · End", "First · last used cell"],
      ["Alt + Page Up · Down", "Previous · next sheet"],
    ],
  ],
  [
    "Edit",
    [
      ["Type", "Replace the cell"],
      ["Enter · F2", "Edit the cell"],
      ["Enter · Tab", "Save and move"],
      ["Esc", "Cancel the edit"],
      ["Delete", "Clear the selection"],
      ["⌘/Ctrl + Z · Shift + Z", "Undo · redo"],
    ],
  ],
  [
    "Select & clipboard",
    [
      ["⌘/Ctrl + A", "Select all"],
      ["Shift + Space", "Select the row"],
      ["Ctrl + Space", "Select the column"],
      ["⌘/Ctrl + C · X · V", "Copy · cut · paste"],
    ],
  ],
];

export const Shortcuts = forwardRef<HTMLDialogElement, { onClose(): void }>(function Shortcuts({ onClose }, ref) {
  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby="shortcuts-title" onClose={onClose}>
      <header className={s.header}>
        <h2 id="shortcuts-title" className={s.title}>
          Keyboard shortcuts
        </h2>
        <form method="dialog">
          <Button small type="submit">
            Close
          </Button>
        </form>
      </header>
      <div className={s.groups}>
        {GROUPS.map(([name, items]) => (
          <section key={name}>
            <h3 className={s.group}>{name}</h3>
            <dl className={s.list}>
              {items.map(([keys, what]) => (
                <div key={keys} className={s.item}>
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
});

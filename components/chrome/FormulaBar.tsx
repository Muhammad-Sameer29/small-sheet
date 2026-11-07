"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { parseRange, type Rect } from "@/lib/engine/address";
import type { CellError } from "@/lib/engine/values";
import { Icon } from "../ui/Icon";
import s from "./FormulaBar.module.css";

interface Props {
  address: string;
  value: string;
  editingHere: boolean;
  error: CellError | null;
  readOnly: boolean;
  onFocusInput(): void;
  onText(text: string): void;
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  onBlur(e: React.FocusEvent<HTMLInputElement>): void;
  onJump(rect: Rect): boolean;
  onLeave(): void;
}

export function FormulaBar(props: Props) {
  const [nameText, setNameText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!invalid) return;
    const t = setTimeout(() => setInvalid(false), 1200);
    return () => clearTimeout(t);
  }, [invalid]);

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const rect = parseRange(nameText ?? "");
      if (rect && props.onJump(rect)) {
        setNameText(null);
        props.onLeave();
      } else setInvalid(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setNameText(null);
      props.onLeave();
    }
  };

  return (
    <div className={s.bar}>
      <input
        className={[s.name, invalid && s.invalid].filter(Boolean).join(" ")}
        value={nameText ?? props.address}
        onChange={(e) => setNameText(e.target.value)}
        onFocus={(e) => {
          setNameText(props.address);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => setNameText(null)}
        onKeyDown={onNameKey}
        aria-label="Cell address. Type an address like C40 and press Enter to go there."
        aria-invalid={invalid || undefined}
        spellCheck={false}
      />
      <span className={s.fx} aria-hidden="true">
        <Icon name="fx" />
      </span>
      <input
        ref={input}
        className={[s.input, props.editingHere && s.editing].filter(Boolean).join(" ")}
        value={props.value}
        readOnly={props.readOnly}
        onFocus={props.onFocusInput}
        onChange={(e) => props.onText(e.target.value)}
        onKeyDown={props.onKeyDown}
        onBlur={props.onBlur}
        aria-label={`Contents of ${props.address}`}
        spellCheck={false}
        autoComplete="off"
        data-formula-input=""
      />
      {props.error && (
        <span className={s.error} role="note">
          <Icon name="alert" size={14} />
          <span className={s.errorCode}>{props.error.code}</span>
          <span className={s.errorText}>
            {props.error.origin ? `From ${props.error.origin}: ` : ""}
            {props.error.message}
          </span>
        </span>
      )}
    </div>
  );
}

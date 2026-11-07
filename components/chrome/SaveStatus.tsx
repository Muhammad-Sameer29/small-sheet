"use client";

import { useEffect, useState } from "react";
import type { SaveStatus as Status } from "@/lib/client/saver";
import { Icon } from "../ui/Icon";
import s from "./SaveStatus.module.css";

function ago(ms: number) {
  const sec = Math.round(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min ago` : "a while ago";
}

export function SaveStatus({ status, onRetry }: { status: Status; onRetry(): void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const changes = `${status.unsaved} change${status.unsaved === 1 ? "" : "s"}`;

  if (status.state === "failed") {
    const wait = status.retryAt ? Math.max(0, Math.ceil((status.retryAt - Date.now()) / 1000)) : 0;
    return (
      <div className={[s.status, s.failed].join(" ")} role="status">
        <Icon name="alert" size={14} />
        <span className={s.text}>
          <strong>Not saved</strong>
          <span className={s.detail}>
            {status.atRisk
              ? ` · ${changes} only in this tab — don't close it`
              : ` · ${changes} kept on this device · retrying${wait ? ` in ${wait}s` : "…"}`}
          </span>
        </span>
        <button type="button" className={s.retry} onClick={onRetry}>
          <Icon name="refresh" size={14} />
          Retry now
        </button>
        <span className={s.tip} role="tooltip">
          {status.error ?? "The last save didn't go through."} Nothing is lost: your edits stay on this device and are sent
          again automatically, even after a reload.
        </span>
      </div>
    );
  }

  if (status.state === "saving") {
    return (
      <div className={s.status} role="status">
        <span className={s.spinner} aria-hidden="true" />
        <span className={s.text}>Saving…</span>
      </div>
    );
  }

  return (
    <div className={[s.status, s.saved].join(" ")} role="status">
      <Icon name="check" size={14} />
      <span className={s.text}>
        Saved<span className={s.detail}>{status.savedAt ? ` · ${ago(Date.now() - status.savedAt)}` : ""}</span>
      </span>
    </div>
  );
}

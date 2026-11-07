"use client";

import { useEffect, useState } from "react";
import { IconButton } from "../ui/Button";

type Theme = "light" | "dark";
const KEY = "small-sheet:theme";

// Follows the system until someone presses it; after that their choice sticks.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const stored = document.documentElement.dataset.theme;
      setTheme(stored === "light" || stored === "dark" ? stored : mq.matches ? "dark" : "light");
    };
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the switch still works for this visit.
    }
    setTheme(next);
  };

  return (
    <IconButton
      icon={theme === "dark" ? "sun" : "moon"}
      label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    />
  );
}

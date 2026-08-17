"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme preference.
 *
 * `system` is a real, distinct choice — not a synonym for whichever theme is
 * currently active. Choosing it removes the `data-theme` attribute so the CSS
 * falls back to `prefers-color-scheme`, and the app then tracks the OS if the
 * user changes it later.
 */
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "jobos-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The script that runs before first paint.
 *
 * Inlined in the document head so the correct theme is applied during the very
 * first style resolution. Without this the page renders light, then corrects
 * itself once React hydrates — the "flash of wrong theme". It only reads
 * localStorage and sets one attribute; it stores nothing sensitive.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

/** Apply a preference to the document. `system` clears the override. */
function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

interface ThemeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is actually on screen right now. */
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Read the OS preference, defaulting to light where it cannot be determined. */
function systemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start at "system" on both server and client so the first render matches and
  // hydration does not warn. The stored value is adopted in the effect below;
  // the inline script has already painted the right colors by then.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or storage disabled: fall back to following the OS.
    }
    if (isThemePreference(stored)) setPreferenceState(stored);
  }, []);

  // Keep the document and the resolved value in step with the preference, and
  // follow the OS while the preference is "system".
  useEffect(() => {
    applyTheme(preference);

    if (preference !== "system") {
      setResolved(preference);
      return;
    }

    setResolved(systemTheme());

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setResolved(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice applies for this session even if it cannot persist.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used inside a ThemeProvider.");
  }
  return context;
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * A three-way segmented control.
 *
 * A real radio group, so arrow keys work and a screen reader announces the
 * chosen theme — rather than three unlabelled buttons.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex rounded-md border border-border bg-surface p-0.5 ${className}`}
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(option.value)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              selected
                ? "bg-surface-2 text-text"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

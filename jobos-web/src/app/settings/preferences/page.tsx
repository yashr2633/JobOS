"use client";

/**
 * Settings -> Preferences
 *
 * Client-rendered because the theme control reads and writes the live theme
 * context. Only genuine, working preferences appear here — there is no
 * notifications toggle, because JobTrackOS sends no notifications and a switch that
 * controls nothing is worse than its absence.
 *
 * The theme choice is stored in localStorage rather than the database: it must
 * apply before the first paint (see `THEME_INIT_SCRIPT`), it is not sensitive,
 * and it is legitimately per-device — a user may want dark on a phone at night
 * and light on a desktop.
 */

import { ThemeToggle, useTheme } from "@/app/components/theme";
import SettingsCard, { SettingsRow } from "../components/SettingsCard";

const DESCRIPTIONS: Record<string, string> = {
  light: "Always use the light theme.",
  dark: "Always use the dark theme.",
  system: "Follow your device's appearance setting.",
};

export default function SettingsPreferencesPage() {
  const { preference, resolved } = useTheme();

  return (
    <>
      <SettingsCard
        title="Appearance"
        description="Choose how JobTrackOS looks on this device."
        footer={
          <p className="text-xs text-text-muted">
            Saved on this device. Other devices keep their own choice.
          </p>
        }
      >
        <ThemeToggle />
        <p className="mt-3 text-sm text-text-secondary">
          {DESCRIPTIONS[preference] ?? DESCRIPTIONS.system}
          {preference === "system" && (
            <> Currently showing the {resolved} theme.</>
          )}
        </p>
      </SettingsCard>

      <SettingsCard
        title="Job scanning"
        description="How JobTrackOS reads your mailbox when you run a Gmail scan."
      >
        <dl className="divide-y divide-border">
          <SettingsRow
            label="Scan window"
            value="Chosen per scan"
            hint="Pick the period to read on the Dashboard before starting a scan."
          />
          <SettingsRow
            label="Automatic organization"
            value="On for strong evidence"
            hint="Applications are created automatically only from unambiguous confirmation emails. Anything uncertain is held for your review."
          />
        </dl>
      </SettingsCard>
    </>
  );
}

import type { ApplicationStatus } from "../types";

/**
 * Status treatments, built from the semantic tokens rather than raw palette
 * classes.
 *
 * The previous version used `text-accent` on `bg-accent/10` and similar —
 * pale text on a pale tint, which was designed for a dark background and failed
 * contrast once the light theme existed. Each token below already carries
 * separate light and dark values, so a badge is legible in both themes.
 *
 * The mapping is meaning-first: Applied is informational, Interview is in
 * progress, Offer is a good outcome, Rejected is a bad one, Ghosted is inert.
 */
const statusStyles: Record<ApplicationStatus, string> = {
  Applied: "bg-accent/10 text-accent ring-accent/20",
  Interview: "bg-warning-bg text-warning ring-warning/25",
  Offer: "bg-success-bg text-success ring-success/25",
  Rejected: "bg-danger-bg text-danger ring-danger/25",
  Ghosted: "bg-surface-2 text-text-secondary ring-border",
};

/** Neutral treatment for a status that is genuinely absent — never "Applied". */
const UNKNOWN_STYLE = "bg-surface-2 text-text-muted ring-border";
const UNKNOWN_LABEL = "Not set";

interface StatusBadgeProps {
  /**
   * `null`/`undefined` means the status is not known here. It renders as a
   * neutral "Not set" badge rather than guessing a real status.
   */
  status: ApplicationStatus | null | undefined;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const isKnown = status !== null && status !== undefined;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        isKnown ? statusStyles[status] : UNKNOWN_STYLE
      }`}
    >
      {isKnown ? status : UNKNOWN_LABEL}
    </span>
  );
}

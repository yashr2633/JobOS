import type { ReactNode } from "react";

/**
 * The one card shape every settings section uses.
 *
 * Exists so five section pages do not each invent their own heading size,
 * padding, and border treatment — the drift this pass is correcting elsewhere in
 * the app. Built from tokens, so it is correct in both themes.
 */
export default function SettingsCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  /** Actions or contextual notes, separated by a rule. */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </div>

      {children && <div className="px-4 py-4 sm:px-5">{children}</div>}

      {footer && (
        <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div>
      )}
    </section>
  );
}

/**
 * A label/value row for read-only account facts.
 *
 * `value` is `ReactNode` so a caller can pass a `<time>` element or a badge, and
 * `null`/empty renders an explicit "Not set" rather than a blank line — §19
 * forbids inventing data, and an empty row reads as a rendering bug.
 */
export function SettingsRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");

  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-text">
        {isEmpty ? <span className="text-text-muted">Not set</span> : value}
      </dd>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

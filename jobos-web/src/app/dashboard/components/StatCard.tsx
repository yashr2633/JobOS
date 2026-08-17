interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  accentColor: string;
}

/**
 * One dashboard figure.
 *
 * Restrained by design: a border and a flat surface, no glow, no gradient. The
 * accent color is applied only to the value and the icon, so the eye lands on
 * the number rather than on the container.
 *
 * Carries no trend badge: a week-over-week percentage per status would need a
 * status-change history, and the schema stores only an application's current
 * status. The real week-over-week movement that IS derivable — new
 * applications — is reported by the trend chart instead.
 */
export default function StatCard({
  title,
  value,
  icon,
  accentColor,
}: StatCardProps) {
  return (
    <div className="group rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-muted">{title}</p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight ${accentColor}`}>
            {value}
          </p>
        </div>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 ${accentColor}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

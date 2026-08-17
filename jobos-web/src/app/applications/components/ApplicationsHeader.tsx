import Link from "next/link";

interface ApplicationsHeaderProps {
  onAddClick: () => void;
  /**
   * Size of the Unknown_Bucket, resolved on the server and passed down. The
   * entry point exists only while there is something in it, so a zero renders
   * nothing at all — no empty state and no disabled control.
   */
  unknownBucketCount?: number;
}

/**
 * Gmail scanning is a discovery/import ENGINE, not a competing list of
 * applications. This is its only remaining presence on the Applications
 * page: a small secondary link next to the primary "Add Application"
 * action. There is no separate Track My Jobs section here and no duplicate
 * application list — everything discovered lands in the one list below.
 */
export default function ApplicationsHeader({
  onAddClick,
  unknownBucketCount = 0,
}: ApplicationsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Applications
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every job you&apos;ve applied to, and what&apos;s happening with it.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {unknownBucketCount > 0 && (
          <Link
            href="/track-my-jobs#unknown"
            className="text-sm font-medium text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {unknownBucketCount} need a company name
          </Link>
        )}

        <Link
          href="/track-my-jobs"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
        >
          Sync from Gmail
        </Link>

        <button
          type="button"
          onClick={onAddClick}
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          + Add Application
        </button>
      </div>
    </div>
  );
}

interface ApplicationsHeaderProps {
  onAddClick: () => void;
}

export default function ApplicationsHeader({
  onAddClick,
}: ApplicationsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Applications</h1>
        <p className="mt-2 text-slate-400">
          Track every job application in one place.
        </p>
      </div>

      <button
        type="button"
        onClick={onAddClick}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        + Add Application
      </button>
    </div>
  );
}

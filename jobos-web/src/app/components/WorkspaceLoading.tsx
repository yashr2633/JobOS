export default function WorkspaceLoading({ title, message }: { title: string; message: string }) {
  return <section aria-busy="true" aria-label={title}>
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    <p role="status" className="mt-2 text-sm text-text-secondary">{message}</p>
    <div aria-hidden="true" className="mt-6 grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map(key => <div key={key} className="rounded-xl border border-border bg-surface p-6">
        <div className="h-3 w-24 rounded bg-surface-2" /><div className="mt-5 h-5 w-3/4 rounded bg-surface-2" />
        <div className="mt-3 h-3 w-1/2 rounded bg-surface-2" /><div className="mt-6 h-9 w-28 rounded bg-surface-2" />
      </div>)}
    </div>
  </section>;
}

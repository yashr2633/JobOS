export default function ResumeFitScore({ score, evidence, compact = false }: { score: number; evidence: string; compact?: boolean }) {
  return <div className={compact ? "mt-4 flex flex-wrap items-center gap-3" : "flex flex-wrap items-center justify-between gap-4"}>
    <div className="rounded-xl bg-accent px-4 py-3 text-accent-fg">
      <p className="text-[11px] font-semibold uppercase tracking-wider">Resume fit</p>
      <p className={`${compact ? "text-2xl" : "text-4xl"} mt-1 font-semibold leading-none tabular-nums`}>{score}<span className="ml-1 text-sm font-medium opacity-80">/100</span></p>
    </div>
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-text">Evidence quality: {evidence}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{compact ? "Open the job to see strengths and gaps." : "Based on your resume, profile preferences and this job's requirements. This is not your probability of getting hired."}</p>
      <div role="meter" aria-label="Resume fit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} className="mt-3 h-2 overflow-hidden rounded-full bg-accent/10"><div className="h-full rounded-full bg-accent" style={{ width: `${score}%` }} /></div>
    </div>
  </div>;
}

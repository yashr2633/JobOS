"use client";
import Link from "next/link";
export default function OpportunityError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-2xl font-semibold">The job source could not be checked</h1><p className="my-4">The source may be temporarily unavailable. This does not confirm that the vacancy is closed.</p><button className="product-button" onClick={reset}>Retry source check</button><Link className="ml-4 underline" href="/jobs">Browse other jobs</Link></main>;
}

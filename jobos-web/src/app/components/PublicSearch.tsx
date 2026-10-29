"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import JobSearchInput from "../jobs/JobSearchInput";
import LocationSearch from "../jobs/LocationSearch";
import { buildSearchVocabulary, type SearchSuggestion } from "@/lib/jobs/searchSuggestions";
import { PUBLIC_CITIES } from "@/lib/jobs/publicBrowsing";
import ProductIcon from "./ProductIcon";
export default function PublicSearch({ initialQuery = "", initialLocation = "India" }: { initialQuery?: string; initialLocation?: string }) {
  const [q, setQ] = useState(initialQuery), [location, setLocation] = useState(initialLocation), [pending, startTransition] = useTransition();
  const router = useRouter();
  const vocabulary = useMemo<SearchSuggestion[]>(() => [...buildSearchVocabulary([]), ...["Amazon", "Google", "Deloitte", "Wipro", "Infosys", "Accenture", "TCS", "Cognizant", "Capgemini", "NielsenIQ", "Sopra Steria"].map(value => ({ value, kind: "Company" as const }))], []);
  return <section className="p-hero" aria-labelledby="p-hero-title"><p className="p-kicker">YOUR NEXT CHAPTER STARTS HERE</p><h1 id="p-hero-title">Find a job. <span>Make your next move.</span></h1><p className="p-lead">Explore opportunities across India. Search freely, then sign in to make it personal.</p>
    <form action="/jobs" className="p-search" onSubmit={event => { event.preventDefault(); const params = new URLSearchParams({ q: q.trim(), location: location.trim() || "India" }); startTransition(() => router.push(`/jobs?${params}#public-jobs`)); }}>
      <div className="p-search-field"><JobSearchInput name="q" value={q} onChange={setQ} vocabulary={vocabulary} /></div><div className="p-search-field"><LocationSearch name="location" value={location} onChange={setLocation} /></div><button type="submit" className="p-primary" disabled={pending}>{pending ? "Searching…" : "Search jobs"}<ProductIcon name="arrow" /></button>
    </form><div className="p-popular"><span>Popular locations</span>{PUBLIC_CITIES.slice(0, 6).map(city => <Link key={city} href={`/jobs?location=${encodeURIComponent(city)}#public-jobs`}>{city}</Link>)}</div>
  </section>;
}

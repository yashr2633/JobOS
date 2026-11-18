import { locationMatches, resolveLocation, resolveState, INDIA_LOCATIONS } from "../jobs/locations.ts";
import type { Job } from "../jobs/types.ts";
import { isPublicListing, JOB_CITIES } from "./jobs.ts";

type JobCity = { slug: string; name: string; filter: string; aliases?: RegExp };
const slugify = (label: string) => label.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const featured = JOB_CITIES.map(city => ({ ...city, filter: city.name }));
const featuredLocations = new Map(featured.flatMap(city => {
  const location = resolveLocation(city.filter);
  return location ? [[location.label, city] as const] : [];
}));
const catalogCities = new Map(INDIA_LOCATIONS.map(location => [
  location.label,
  featuredLocations.get(location.label) ?? {
    slug: slugify(location.label), name: location.city, filter: location.label,
  },
]));
const citiesBySlug = new Map([...catalogCities.values(), ...featured].map(city => [city.slug, city]));
const states = new Map([...new Set(INDIA_LOCATIONS.map(city => city.state))].map(name => [
  name, { slug: `state-${slugify(name)}`, name, filter: name },
]));
const statesBySlug = new Map([...states.values()].map(state => [state.slug, state]));

export function findJobCity(slug: string): JobCity | undefined {
  return citiesBySlug.get(slug) ?? statesBySlug.get(slug);
}

export function matchesJobCity(job: Pick<Job, "location" | "workMode" | "remoteIndiaEligible">, city: JobCity) {
  if (job.workMode === "Remote" && job.remoteIndiaEligible) return false;
  return city.aliases?.test(job.location) ?? locationMatches(job.location, city.filter);
}

/** Only recognized India locations with at least one current public listing. */
export function catalogJobCities(jobs: Job[], now = Date.now()) {
  const active = new Map<string, JobCity>();
  for (const job of jobs) {
    if (!isPublicListing(job, now) || (job.workMode === "Remote" && job.remoteIndiaEligible)) continue;
    for (const city of featured) if (matchesJobCity(job, city)) active.set(city.slug, city);
    const parts = job.location.split(/[,·/|;]+/).map(part => part.trim());
    const states = parts.map(resolveState).filter((state): state is string => Boolean(state));
    for (const part of parts) {
      const locations = states.length
        ? states.map(state => resolveLocation(`${part}, ${state}`))
        : [resolveLocation(part)];
      for (const location of locations) {
        const city = location && catalogCities.get(location.label);
        if (city && matchesJobCity(job, city)) active.set(city.slug, city);
      }
    }
  }
  return [...active.values()].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

/** State pages cover real openings and link back to the active city directory. */
export function catalogJobLocations(jobs: Job[], now = Date.now()) {
  const cities = catalogJobCities(jobs, now);
  const activeStates = new Map<string, JobCity>();
  for (const job of jobs) {
    if (!isPublicListing(job, now) || (job.workMode === "Remote" && job.remoteIndiaEligible)) continue;
    for (const part of job.location.split(/[,·/|;]+/)) {
      const state = states.get(resolveState(part.trim()) ?? resolveLocation(part.trim())?.state ?? "");
      if (state && matchesJobCity(job, state)) activeStates.set(state.slug, state);
    }
  }
  return [...cities, ...[...activeStates.values()].sort((a, b) => a.name.localeCompare(b.name))];
}

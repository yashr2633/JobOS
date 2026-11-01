import type { Job } from "../jobs/types.ts";
import { isActiveRecommendation } from "../jobs/ranking.ts";
import { normalizeIndiaLocation } from "../jobs/sources-india.ts";
import { plainText, safeJobUrl } from "../jobs/normalize.ts";
import { SITE_ORIGIN } from "./metadata.ts";

export const JOB_CITIES = [
  { slug: "bangalore", name: "Bangalore", aliases: /bangalore|bengaluru/i },
  { slug: "delhi-ncr", name: "Delhi NCR", aliases: /delhi|noida|gurgaon|gurugram|faridabad|ghaziabad/i },
  ...["Mumbai", "Kolkata", "Hyderabad", "Pune", "Chennai", "Jaipur", "Ranchi", "Dhanbad", "Bokaro"].map(name => ({ slug: name.toLowerCase(), name, aliases: new RegExp(name, "i") })),
];
export function opportunityPath(id: string) { return `/opportunities/${encodeURIComponent(id)}`; }
export function opportunityId(value: string) {
  try {
    const id = decodeURIComponent(value);
    return /^(greenhouse|lever|ashby|smartrecruiters):[a-zA-Z0-9_-]{1,80}:[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch { return null; }
}
export function isPublicListing(job: Job, now = Date.now()) {
  return opportunityId(job.id) === job.id
    && isActiveRecommendation(job, now) && normalizeIndiaLocation(job.location).isIndia
    && !!safeJobUrl(job.applicationUrl) && !!safeJobUrl(job.sourceUrl)
    && !!job.title.trim() && !!job.company.trim();
}
export function isPublicOpportunity(job: Job, now = Date.now()) {
  return isPublicListing(job, now) && !job.descriptionPending && plainText(job.description).length >= 200;
}
export function jobPosting(job: Job, now = Date.now()) {
  // Unknown original posting dates never become fetch/release dates for Google.
  const posted = job.postedAt ? Date.parse(job.postedAt) : NaN;
  if (!isPublicOpportunity(job, now) || !Number.isFinite(posted) || posted > now) return null;
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const description = plainText(job.description).split(/\n+/).filter(Boolean).map(line => `<p>${escape(line)}</p>`).join("");
  const remote = job.workMode === "Remote" && (job.remoteIndiaEligible || normalizeIndiaLocation(job.location).isIndia);
  const employment = ({ "full time": "FULL_TIME", "part time": "PART_TIME", "contract": "CONTRACTOR", "internship": "INTERN" } as Record<string, string>)[(job.employmentType ?? "").replace(/[-_]/g, " ").toLowerCase()];
  return {
    "@context": "https://schema.org", "@type": "JobPosting",
    title: job.title, description, datePosted: new Date(posted).toISOString(),
    url: new URL(opportunityPath(job.id), SITE_ORIGIN).href,
    identifier: { "@type": "PropertyValue", name: job.company, value: job.externalId },
    hiringOrganization: { "@type": "Organization", name: job.company },
    ...(remote ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "India" } }
      : { jobLocation: { "@type": "Place", name: job.location, address: { "@type": "PostalAddress", addressCountry: "IN" } } }),
    ...(job.expiresAt && Number.isFinite(Date.parse(job.expiresAt)) ? { validThrough: new Date(job.expiresAt).toISOString() } : {}),
    ...(employment ? { employmentType: employment } : {}),
    directApply: false,
  };
}
export const safeJsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
export function opportunitySitemap(jobs: Job[], now = Date.now()) {
  // ATS list feeds may omit descriptions. Their detail route hydrates the full
  // record through the existing allowlisted provider before rendering/indexing.
  return [...new Set(jobs.filter(job => isPublicListing(job, now)).map(job => new URL(opportunityPath(job.id), SITE_ORIGIN).href))];
}

import type { Job } from "../jobs/types.ts";
import { roleEvidenceText } from "../jobs/jobEvidence.ts";
import { isPublicListing, JOB_CITIES } from "./jobs.ts";

export const MIN_COLLECTION_JOBS = 3;

const roles = [
  { slug: "fresher", name: "Fresher", query: "Fresher", title: /\b(?:fresher|graduate trainee|new grad|entry.level)s?\b/i, tip: "Check whether the employer accepts your graduation year and degree. Use a college project or internship to show a skill listed in the job description." },
  { slug: "bba-fresher", name: "BBA fresher", query: "BBA", title: /\b(?:bba|bachelor of business administration)\b/i, tip: "Check the accepted degrees and experience before applying. For sales or operations roles, use a project that shows your work with customers, spreadsheets or a measurable outcome." },
  { slug: "software-fresher", name: "Software fresher", query: "Software Engineer", title: /\b(?:software|frontend|backend|full.stack|developer|programmer|qa engineer)\b/i, tip: "Check the required language and stack. Link to one project and describe your contribution, how you tested it and how someone can run it." },
  { slug: "computer-operator", name: "Computer operator", query: "Computer Operator", title: /\bcomputer operator\b/i, tip: "Check typing speed, shift hours and the specific software required. Mention Excel, Tally or typing speed only if you can demonstrate it." },
  { slug: "data-entry", name: "Data entry", query: "Data Entry", title: /\bdata entry\b/i, tip: "Check whether the role requires spreadsheet work, transcription or record verification. Confirm the employer and working hours before sharing documents." },
  { slug: "customer-support", name: "Customer support", query: "Customer Support", title: /\b(?:customer (?:service|support|care)|contact cent(?:er|re)|call cent(?:er|re))\b/i, tip: "Check the required languages, shift and whether the role involves calls or chat. Give one example of resolving a customer issue." },
  { slug: "sales", name: "Sales", query: "Sales", title: /\b(?:sales|business development)\b/i, tip: "Check if the role is field, inside or enterprise sales. Look for fixed pay, incentive terms and territory in the employer description." },
  { slug: "accounting", name: "Accounting", query: "Accountant", title: /\b(?:accountant|accounting|bookkeeper|accounts (?:payable|receivable|executive))\b/i, tip: "Check the tools, accounting standards and responsibilities. Highlight relevant reconciliation, reporting or bookkeeping work." },
  { slug: "data-analyst", name: "Data analyst", query: "Data Analyst", title: /\b(?:data analyst|analytics analyst|business intelligence analyst|bi analyst)\b/i, tip: "Show an analysis you can explain end to end, from the source data and SQL to the decision it supported." },
  { slug: "digital-marketing", name: "Digital marketing", query: "Digital Marketing", title: /\b(?:digital marketing|seo (?:analyst|specialist|executive)|performance marketing|paid media)\b/i, tip: "Use one campaign or project to show the channel, goal, work you did and how you measured it." },
  { slug: "software", name: "Software engineering", query: "Software Engineer", title: /\b(?:software (?:engineer|developer)|frontend|backend|full.stack)\b/i, tip: "Read the stack and seniority requirements. Lead your resume with a project that shows the work this team needs." },
  { slug: "operations", name: "Operations", query: "Operations", title: /\boperations\b/i, tip: "Check the type of operations and shift requirements. Highlight a process you improved and describe the result." },
  { slug: "internships", name: "Internships", query: "Intern", title: /\b(?:intern|internship)\b/i, tip: "Check the duration, work mode, stipend and whether your college schedule fits before applying." },
] as const;

const mainCities = new Set(["noida", "delhi", "bangalore", "hyderabad", "kolkata", "mumbai", "pune", "chennai", "jaipur"]);
const localCities = new Set(["ranchi", "dhanbad", "bokaro", "jamshedpur", "deoghar", "siliguri", "patna"]);
type Role = (typeof roles)[number];
type City = (typeof JOB_CITIES)[number];

export type JobCollection = { slug: string; title: string; role: Role; city?: City };

function collection(role: Role, city?: City): JobCollection {
  const label = role.slug === "internships" ? role.name : role.name + " jobs";
  return {
    slug: city ? role.slug + "-in-" + city.slug : role.slug,
    title: label + " in " + (city?.name ?? "India"),
    role,
    city,
  };
}

export const JOB_COLLECTIONS = roles.flatMap(role => [
  collection(role),
  ...JOB_CITIES.filter(city => mainCities.has(city.slug) || (
    localCities.has(city.slug) &&
    ["computer-operator", "data-entry", "fresher", "sales", "accounting", "customer-support", "operations"].includes(role.slug)
  )).map(city => collection(role, city)),
]);

export const collectionPath = (item: JobCollection) => "/job-search/" + item.slug;

function matchesRole(job: Job, role: Role) {
  if (role.slug === "internships") return role.title.test(job.title) || /internship/i.test(job.employmentType ?? "");
  if (role.slug !== "fresher" && role.slug !== "bba-fresher" && role.slug !== "software-fresher") return role.title.test(job.title);
  if (role.slug === "software-fresher" && !role.title.test(job.title)) return false;

  const description = roleEvidenceText(job.description);
  const eligibility = [description, ...job.requirements].join("\n");
  const earlyCareer = job.minYearsExperience === 0 || (
    job.minYearsExperience === null && (
      roles[0].title.test(job.title) ||
      /\b(?:freshers? (?:are |may be )?(?:welcome|eligible|can apply)|no (?:prior |work )?experience (?:is )?(?:needed|required)|0\s*[-–]\s*[12]\s*years?)\b/i.test(eligibility)
    )
  );
  if (role.slug === "fresher") return earlyCareer;
  if (role.slug === "bba-fresher") return earlyCareer && role.title.test(job.title + "\n" + eligibility);
  return earlyCareer;
}

export function buildJobCollections(source: Job[], now = Date.now()) {
  const active = [...new Map(source.filter(job => isPublicListing(job, now)).map(job => [job.id, job])).values()];
  return roles.flatMap(role => {
    const matches = active.filter(job => matchesRole(job, role)).sort((a, b) =>
      (b.postedAt ?? b.releasedAt ?? b.updatedAt ?? "").localeCompare(a.postedAt ?? a.releasedAt ?? a.updatedAt ?? "") ||
      a.id.localeCompare(b.id)
    );
    return JOB_COLLECTIONS.filter(item => item.role === role).map(item => ({
      ...item,
      jobs: item.city ? matches.filter(job =>
        item.city!.aliases.test(job.location) && !(job.workMode === "Remote" && job.remoteIndiaEligible)
      ) : matches,
    }));
  });
}


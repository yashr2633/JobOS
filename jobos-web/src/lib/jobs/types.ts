export type WorkMode = "Remote" | "Hybrid" | "On-site";

export interface CareerProfile {
  roles: string[];
  skills: string[];
  yearsExperience: number | null;
  locations: string[];
  workModes: WorkMode[];
  salaryMin: number | null;
  salaryCurrency: string;
  resumeId: string | null;
  keywords: string[];
}

export interface Job {
  id: string;
  source: string;
  board: string;
  externalId: string;
  company: string;
  title: string;
  description: string;
  requirements: string[];
  location: string;
  workMode: WorkMode | null;
  minYearsExperience: number | null;
  skills: string[];
  salary: { min: number | null; max: number | null; currency: string; period: string | null } | null;
  employmentType: string | null;
  postedAt: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
  applicationUrl: string;
  sourceUrl: string;
}

export interface JobState {
  job_id: string;
  saved: boolean;
  hidden: boolean;
  apply_started_at: string | null;
  application_id: string | null;
  snapshot: Job;
}

export interface ResumeEvidence {
  id: string;
  label: string;
  skills: string[];
  roles: string[];
  yearsExperience: number | null;
}

export interface JobFit {
  score: number;
  strengths: string[];
  gaps: string[];
  matchedSkills: string[];
  missingSkills: string[];
  components: { label: string; points: number; available: number }[];
  evidence: "Limited" | "Moderate" | "Strong";
}

export const EMPTY_PROFILE: CareerProfile = {
  roles: [], skills: [], yearsExperience: null, locations: [], workModes: [],
  salaryMin: null, salaryCurrency: "", resumeId: null, keywords: [],
};

import { EMPTY_INTENT, publicCareerMessage, validateCareerIntent, type CareerIntent } from "./careerIntent.ts";
import { findCompany } from "./companies.ts";
import { buildSearchVocabulary } from "./searchSuggestions.ts";
import { resolveLocation, resolveState } from "./locations.ts";
import { preferenceSearch } from "./preferenceSearch.ts";
import type { ResumeEvidence } from "./types.ts";

export type CareerReply = { kind: "search"; intent: CareerIntent } | { kind: "clarify"; question: string; suggestions: string[]; context?: CareerIntent };
/** Use already extracted resume evidence locally, never as public search text. */
export function resumeCareerReply(message: string, resume?: ResumeEvidence, previous?: string, profileYears?: number | null): CareerReply | null {
  if (!publicCareerMessage(message) || !/\b(resume|cv)\b/i.test(message) || !/\b(jobs?|roles?|opportunities|matches)\b/i.test(message)) return null;
  if (!resume || resume.usable === false || !resume.suggestedRoles?.length) return { kind: "clarify", question: "Add or select a readable resume below for resume-based matching, or choose a role to search without one.", suggestions: ["Data Analyst jobs", "Sales Executive jobs", "Operations Associate jobs"] };
  const remaining = message.replace(/\b(the|can|you|find|search|show|suggest|recommend|best|suitable|relevant|matches|matching|jobs?|roles?|opportunities|for|me|my|this|attached|uploaded|resume|cv|based|on|according|to|profile|skills|and|experience|please)\b/gi, " ").replace(/\s+/g, " ").trim();
  const base = preferenceSearch("jobs " + remaining, previous);
  if (!base) return null; // Unknown locations still need clarification.
  const role = base.role && base.role !== "jobs" ? base.role : resume.suggestedRoles.includes("Data Analyst") ? "Data Analyst" : resume.suggestedRoles[0];
  const years = resume.yearsExperience ?? profileYears ?? null;
  if (years === null && !base.experience) return { kind: "clarify", context: { ...base, role }, question: `Your resume suggests ${role} roles. Your experience level is not available yet. Which search range should I use?`, suggestions: ["Fresher jobs", "Up to 3 years experience", "Up to 5 years experience"] };
  const experience = base.experience || (years === null ? "" : years <= 1 ? "entry" : years <= 3 ? "3" : years <= 5 ? "5" : "10");
  return { kind: "search", intent: { ...base, role, experience } };
}
/** Provider failure is not a failed job search. Keep the conversation actionable. */
export function recoverCareerReply(message: string, previous?: string): CareerReply | null {
  if (!publicCareerMessage(message)) return null;
  const quick = quickCareerReply(message, previous);
  if (quick) return quick;
  return { kind: "clarify", question: "I could not interpret that request reliably. Enter the role or company and an Indian city, or choose a role below. Your earlier search preferences are kept.", suggestions: ["Data Analyst jobs", "Sales Executive jobs", "Operations Associate jobs"] };
}
const key = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").trim().replace(/\s+/g, " ");
const vocabulary = buildSearchVocabulary([]);
/** A clear graduate/fresher request can start broad; choosing a role is optional. */
export function graduateSearch(message: string): CareerIntent | null {
  if (!publicCareerMessage(message)) return null;
  const normalized = key(message);
  if (!/\b(fresher|freshers|entry level)\b|फ्रेशर|फ्रेशर्स/u.test(normalized)) return null;
  const degree = normalized.match(/\b(bba|bcom|b com|mba|btech|b tech|graduate)\b/);
  const qualification = degree ? ({ bba: "BBA", bcom: "BCom", "b com": "BCom", mba: "MBA", btech: "BTech", "b tech": "BTech", graduate: "Graduate" } as Record<string, string>)[degree[1]] : undefined;
  const remainder = normalized.replace(/\b(i am|i m|im|a|an|bba|bcom|b com|mba|b tech|btech|graduate|fresher|freshers|entry level|find|me|show|want|need|looking|for|jobs?|roles?|please)\b|फ्रेशर|फ्रेशर्स|हूँ|हूं|जॉब|नौकरी|चाहिए/gu, " ").replace(/\s+/g, " ").trim().replace(/^(?:in|near|at)\s+/, "");
  const location = !remainder || /^(india|all india|anywhere in india)$/.test(remainder) ? "India" : resolveLocation(remainder)?.label ?? resolveState(remainder);
  if (!location) return null; // A role or an unclear location still needs interpretation.
  return { ...EMPTY_INTENT, location, experience: "entry", ...(qualification ? { qualification } : {}) };
}
/** Fast, transparent preference handling. No vacancies or candidate facts are inferred. */
export function quickCareerReply(message: string, previous: boolean | string = false): CareerReply | null {
  if (!publicCareerMessage(message)) return null;
  const hasPrevious = !!previous;
  const preferences = typeof previous === "string" || !previous ? preferenceSearch(message, typeof previous === "string" ? previous : undefined) : null;
  if (preferences) return { kind: "search", intent: preferences };
  const normalized = key(message), company = findCompany(message);
  const entry = /\b(fresher|freshers|entry level)\b/.test(normalized);
  const roleWords = normalized.replace(/\b(fresher|freshers|entry level|jobs?)\b/g, " ").replace(/\s+/g, " ").trim();
  const role = vocabulary.find(value => key(value.value) === roleWords);
  const graduate = !hasPrevious ? graduateSearch(message) : null;
  if (graduate) return { kind: "search", intent: graduate };
  if (company && !hasPrevious) return { kind: "search", intent: { ...EMPTY_INTENT, company: company.name } };
  if (role && !hasPrevious) return { kind: "search", intent: { ...EMPTY_INTENT, role: role.value, experience: entry ? "entry" : "" } };
  if (!hasPrevious && normalized.split(" ").length <= 3 && !/\b(jobs?|vacanc\w*|hiring|find|search|want|in|near|at|remote)\b|नौकरी|जॉब|चाहिए/u.test(normalized))
    return { kind: "clarify", question: `What does “${message.trim().slice(0, 80)}” refer to — a job role, a company, or something else? Add a little detail, or search those exact words.`, suggestions: ["Fresher jobs"] };
  return null;
}
export function validateCareerReply(raw: unknown): CareerReply | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === "search" || (!value.kind && value.intent)) {
    const intent = validateCareerIntent(value.intent);
    return intent && (intent.role || intent.company || intent.experience === "entry") ? { kind: "search", intent } : null;
  }
  if (value.kind !== "clarify" || typeof value.question !== "string" || value.question.length < 8 || value.question.length > 280 || /[@<>]|https?:|\b\d{8,}\b/i.test(value.question) || !Array.isArray(value.suggestions) || value.suggestions.length > 4) return null;
  const suggestions = value.suggestions.filter((item): item is string => typeof item === "string" && item.length <= 100 && publicCareerMessage(item));
  if (suggestions.length !== value.suggestions.length) return null;
  return { kind: "clarify", question: value.question, suggestions };
}

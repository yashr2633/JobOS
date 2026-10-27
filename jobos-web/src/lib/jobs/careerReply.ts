import { EMPTY_INTENT, publicCareerMessage, validateCareerIntent, type CareerIntent } from "./careerIntent.ts";
import { findCompany } from "./companies.ts";
import { buildSearchVocabulary } from "./searchSuggestions.ts";

export type CareerReply = { kind: "search"; intent: CareerIntent } | { kind: "clarify"; question: string; suggestions: string[] };
const key = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, " ").trim().replace(/\s+/g, " ");
const vocabulary = buildSearchVocabulary([]);
/** Fast, transparent preference handling. No vacancies or candidate facts are inferred. */
export function quickCareerReply(message: string, hasPrevious = false): CareerReply | null {
  if (!publicCareerMessage(message)) return null;
  const normalized = key(message), company = findCompany(message);
  const entry = /\b(fresher|freshers|entry level)\b/.test(normalized);
  const roleWords = normalized.replace(/\b(fresher|freshers|entry level|jobs?)\b/g, " ").replace(/\s+/g, " ").trim();
  const role = vocabulary.find(value => key(value.value) === roleWords);
  if (company && !hasPrevious) return { kind: "search", intent: { ...EMPTY_INTENT, company: company.name } };
  if (role && !hasPrevious) return { kind: "search", intent: { ...EMPTY_INTENT, role: role.value, experience: entry ? "entry" : "" } };
  if (/^(?:(?:i am|i m|im|a|bba|bcom|b com|mba|b tech|btech)\s+)*(?:fresher|freshers|entry level|फ्रेशर|फ्रेशर्स)(?:\s+(?:jobs?|roles?|हूँ|हूं))?$/.test(normalized))
    return { kind: "clarify", question: "Which kind of fresher role would you like? You can choose a suggestion or describe another field.", suggestions: ["Sales Executive fresher jobs", "Data Analyst fresher jobs", "Customer Support Executive fresher jobs"] };
  if (!hasPrevious && normalized.split(" ").length <= 3 && !/\b(jobs?|vacanc\w*|hiring|find|search|want|in|near|at|remote)\b|नौकरी|जॉब|चाहिए/u.test(normalized))
    return { kind: "clarify", question: `What does “${message.trim().slice(0, 80)}” refer to — a job role, a company, or something else? Add a little detail, or search those exact words.`, suggestions: ["Fresher jobs"] };
  return null;
}
export function validateCareerReply(raw: unknown): CareerReply | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === "search" || (!value.kind && value.intent)) {
    const intent = validateCareerIntent(value.intent);
    return intent && (intent.role || intent.company) ? { kind: "search", intent } : null;
  }
  if (value.kind !== "clarify" || typeof value.question !== "string" || value.question.length < 8 || value.question.length > 280 || /[@<>]|https?:|\b\d{8,}\b/i.test(value.question) || !Array.isArray(value.suggestions) || value.suggestions.length > 4) return null;
  const suggestions = value.suggestions.filter((item): item is string => typeof item === "string" && item.length <= 100 && publicCareerMessage(item));
  if (suggestions.length !== value.suggestions.length) return null;
  return { kind: "clarify", question: value.question, suggestions };
}

import { EMPTY_INTENT, publicCareerMessage, type CareerIntent } from "./careerIntent.ts";
import { companyDirectory } from "./companies.ts";
import { resolveLocation, resolveState } from "./locations.ts";
import { buildSearchVocabulary } from "./searchSuggestions.ts";

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}+#]+/gu, " ").trim().replace(/\s+/g, " ");
const companies = companyDirectory().flatMap(company => [company.name, ...company.aliases].map(alias => ({ name: company.name, words: normalize(alias) }))).sort((a, b) => b.words.length - a.words.length);
const vocabulary = buildSearchVocabulary([]);
const phrase = (text: string, value: string) => (` ${text} `).includes(` ${value} `);

/** Extract explicit public preferences, not vacancies or inferred candidate facts.
 * Common searches work without a model. Unclear locations/questions still ask
 * for clarification rather than silently searching a different city.
 */
export function preferenceSearch(message: string, previous?: string): CareerIntent | null {
  if (!publicCareerMessage(message)) return null;
  const text = normalize(message);
  if (/\b(why|how|which|explain|probability|chances)\b/.test(text)) return null;
  if (/\b(not|except|exclude|excluding|without)\b/.test(text) || /\b\d+ years?\b/.test(text) && !/\b(3|5|10) years?\b/.test(text)) return null;
  const prior = previous ? preferenceSearch(previous) : null;
  // A clarification has no confirmed filters yet. An explicit chosen role or
  // fresher suggestion must still work when the model is unavailable.
  if (previous && !prior) return preferenceSearch(message);
  let rest = text;
  const company = companies.find(item => phrase(text, item.words));
  if (company) rest = ` ${rest} `.replace(` ${company.words} `, " ").trim();

  // Match the longest supported city/state phrase, including a state qualifier.
  const words = rest.split(" "), places: { value: string; label: string; start: number; end: number }[] = [];
  for (let start = 0; start < words.length; start++) for (let size = Math.min(7, words.length - start); size > 0; size--) {
    const value = words.slice(start, start + size).join(" ");
    const city = resolveLocation(value);
    // Avoid interpreting short state codes such as "UP" in "up to 3 years".
    const state = value.length > 3 ? resolveState(value) : undefined;
    if (city || state) places.push({ value, label: city?.label ?? state!, start, end: start + size });
  }
  places.sort((a, b) => b.value.length - a.value.length);
  const place = places[0];
  if (place && places.some(other => other.label !== place.label && (other.end <= place.start || other.start >= place.end))) return null;
  if (place) rest = ` ${rest} `.replace(` ${place.value} `, " ").trim();
  const allIndia = /\b(all over india|all india|across india|anywhere in india|pan india)\b/.test(text);
  const explicitIndia = /\bindia\b/.test(text);
  if (!place && /\b(in|near|around|location|city)\b/.test(rest) && !explicitIndia && !/\bremote\b/.test(rest)) return null;
  const location = allIndia ? "India" : place?.label ?? (explicitIndia ? "India" : prior?.location ?? "India");

  const degree = text.match(/\b(bba|bcom|b com|mba|btech|b tech|graduate)\b/)?.[1];
  const qualification = degree ? ({ bba: "BBA", bcom: "BCom", "b com": "BCom", mba: "MBA", btech: "BTech", "b tech": "BTech", graduate: "Graduate" } as Record<string, string>)[degree] : prior?.qualification;
  const entry = /\b(fresher|freshers|entry level|no experience)\b|फ्रेशर|फ्रेशर्स/u.test(text);
  const years = text.match(/\b(?:up to )?(3|5|10) years?(?: experience)?\b/)?.[1];
  const mode = /\bremote\b/.test(text) ? "Remote" : /\bhybrid\b/.test(text) ? "Hybrid" : /\bon site\b/.test(text) ? "On-site" : prior?.mode ?? "";
  const days = /\btoday\b|आज/u.test(text) ? "1" : text.match(/\blast (1|3|7|14|30|90|180) days?\b/)?.[1] ?? (/\ball dates\b/.test(text) ? "" : prior?.days ?? "30");
  rest = rest.replace(/\b(?:up to )?(?:3|5|10) years?(?: experience)?\b|\blast \d+ days?\b|\ball dates\b/g, " ")
    .replace(/\b(all over|anywhere|across|pan|all|any|some|india|i am|i m|im|i|am|a|an|bba|bcom|b com|mba|btech|b tech|graduate|fresher|freshers|entry level|no experience|find|search|give|get|list|suggest|recommend|me|show|want|need|looking|for|jobs?|roles?|positions?|vacancies|openings?|opportunities|options|available|current|latest|new|suitable|please|in|near|around|at|from|location|city|only|remote|hybrid|on site|today|experience|employer|company|last|days|instead|switch|change|to)\b|\b\d{1,3}\b|फ्रेशर|फ्रेशर्स|हूँ|हूं|मुझे|में|जॉब्स|जॉब|नौकरी|चाहिए|ढूंढो|दिखाओ|आज/gu, " ").replace(/\s+/g, " ").trim();
  const known = vocabulary.find(item => normalize(item.value) === rest);
  const explicitSearch = /\b(jobs?|roles?|positions?|vacancies|openings?|find|search)\b|जॉब|नौकरी/u.test(text);
  if (rest && (!known && !explicitSearch && !place && !prior || rest.length > 80)) return null;
  const role = rest ? known?.value ?? rest : company || entry ? "" : prior?.role ?? (explicitSearch || degree ? "jobs" : "");
  const intent: CareerIntent = { ...EMPTY_INTENT, role, company: company?.name ?? prior?.company ?? "", location, experience: entry ? "entry" : years ?? prior?.experience ?? "", mode, days, ...(qualification ? { qualification } : {}) };
  return intent.role || intent.company || intent.experience === "entry" ? intent : null;
}

import { buildSearchVocabulary, publicJobQuery, searchSuggestions } from "./searchSuggestions.ts";
import { INDIA_LOCATIONS, locationSuggestions } from "./locations.ts";
import { companySuggestions } from "./companies.ts";

export interface CareerSuggestion { value: string; kind: "Qualification" | "Role" | "Skill" | "Field" | "City" | "State" | "Country" | "Company" | "Work mode" }
const clean = (value: string) => value.toLowerCase().replace(/\./g, "").replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
const matches = (value: string, query: string) => clean(query).split(" ").every(word => clean(value).split(" ").some(token => token.startsWith(word)));
const degrees = [
  ["BBA", "Bachelor of Business Administration"], ["B.Com", "BCom Bachelor of Commerce"], ["BA", "Bachelor of Arts"], ["B.Sc", "BSc Bachelor of Science"],
  ["BCA", "Bachelor of Computer Applications"], ["B.Tech", "BTech Bachelor of Technology"], ["BE", "Bachelor of Engineering"], ["MBA", "Master of Business Administration"],
  ["M.Com", "MCom Master of Commerce"], ["MCA", "Master of Computer Applications"], ["M.Sc", "MSc Master of Science"], ["MA", "Master of Arts"], ["M.Tech", "MTech Master of Technology"],
  ["B.Pharm", "BPharm Bachelor of Pharmacy"], ["D.Pharm", "DPharm Diploma in Pharmacy"], ["MBBS", "Medicine"], ["BDS", "Dentistry"], ["B.Ed", "BEd Bachelor of Education"],
  ["LLB", "Bachelor of Laws"], ["LLM", "Master of Laws"], ["CA", "Chartered Accountant"], ["ITI", "Industrial Training Institute"], ["Diploma", "Polytechnic"], ["12th pass", "Class 12 Higher Secondary"], ["10th pass", "Class 10 Secondary"],
] as const;
const vocabulary = buildSearchVocabulary([]);
const states = [...new Set(INDIA_LOCATIONS.map(location => location.state))];
const fields = ["Finance", "Banking", "Marketing", "Sales", "Human Resources", "IT", "Hospitality", "Healthcare", "Education", "Manufacturing", "Retail", "Logistics", "Real Estate", "Operations", "Customer Support", "Government", "Fresher", "Graduate"];

/** Search vocabulary only. No vacancy counts, external requests or resume data. */
export function careerSuggestions(query: string, limit = 12): CareerSuggestion[] {
  if (!query.trim() || query.length > 120 || !publicJobQuery(query) || limit <= 0) return [];
  const result: CareerSuggestion[] = [], seen = new Set<string>();
  function add(value: string, kind: CareerSuggestion["kind"]) {
    const key = clean(value);
    if (!seen.has(key)) { seen.add(key); result.push({ value, kind }); }
  }
  const education = degrees.flatMap(([degree, aliases]) => ["jobs", "fresher jobs", "graduate jobs", "internships"].map(suffix => ({ value: `${degree} ${suffix}`, aliases: `${aliases} ${suffix}` })))
    .filter(item => matches(item.value, query) || matches(item.aliases, query)).slice(0, 5);
  education.forEach(item => add(item.value, "Qualification"));
  fields.filter(field => matches(`${field} jobs`, query)).slice(0, 2).forEach(field => add(`${field} jobs`, "Field"));
  searchSuggestions(vocabulary, query.replace(/\bjobs?\b/gi, "").trim(), 4).forEach(item => add(`${item.value} jobs`, item.kind === "Skill" ? "Skill" : "Role"));
  const place = query.replace(/\b(?:jobs?|in)\b/gi, " ").trim();
  if (place) {
    locationSuggestions(place, 3).forEach(location => add(`Jobs in ${location.label}`, "City"));
    states.filter(state => matches(state, place)).slice(0, 1).forEach(state => add(`Jobs in ${state}`, "State"));
    if (matches("India", place)) add("Jobs in India", "Country");
  }
  ["Remote jobs in India", "Work from home jobs", "Part time jobs", "Internships in India"].filter(value => matches(value, query)).slice(0, 2).forEach(value => add(value, "Work mode"));
  companySuggestions(query.replace(/\bjobs?\b/gi, "").trim(), [], 2).forEach(company => add(`${company.name} jobs`, "Company"));
  return result.slice(0, Math.min(20, Math.floor(limit)));
}

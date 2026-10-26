import cities from "./india-locations.json" with { type: "json" };

export interface LocationOption { label: string; city: string; state: string; aliases: string[]; population: number }
const clean = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
const stateCodes: Record<string, string[]> = {
  "Andhra Pradesh": ["AP"], "Arunachal Pradesh": ["AR"], Assam: ["AS"], Bihar: ["BR", "बिहार"],
  Chhattisgarh: ["CG", "CT"], Delhi: ["DL", "New Delhi", "दिल्ली"], Goa: ["GA"], Gujarat: ["GJ"],
  Haryana: ["HR"], "Himachal Pradesh": ["HP"], "Jammu and Kashmir": ["JK"], Jharkhand: ["JH", "झारखंड", "झारखण्ड"],
  Karnataka: ["KA"], Kerala: ["KL"], "Madhya Pradesh": ["MP"], Maharashtra: ["MH"], Manipur: ["MN"],
  Meghalaya: ["ML"], Mizoram: ["MZ"], Nagaland: ["NL"], Odisha: ["OD", "OR", "Orissa"], Punjab: ["PB"],
  Rajasthan: ["RJ"], Sikkim: ["SK"], "Tamil Nadu": ["TN"], Telangana: ["TG", "TS"], Tripura: ["TR"],
  "Uttar Pradesh": ["UP"], Uttarakhand: ["UK", "UT", "Uttaranchal"], "West Bengal": ["WB"],
  "Andaman and Nicobar": ["AN"], Chandigarh: ["CH"], "Dadra and Nagar Haveli and Daman and Diu": ["DN", "DD"],
  Ladakh: ["LA"], Lakshadweep: ["LD"], Puducherry: ["PY", "Pondicherry"],
};
const cityAliases: Record<string, string[]> = { Bengaluru: ["Bangalore"], Mumbai: ["Bombay"], Gurugram: ["Gurgaon"], Kolkata: ["Calcutta"], Chennai: ["Madras"], Kochi: ["Cochin"], Thiruvananthapuram: ["Trivandrum"], Varanasi: ["Benares", "Banaras"] };
const stateNames = [...new Set(cities.map(city => city.state))];
const stateLookup = new Map(stateNames.flatMap(state => [state, ...(stateCodes[state] ?? [])].map(alias => [clean(alias), state])));
const unique = new Map<string, LocationOption>();
for (const city of cities) {
  const label = `${city.name}, ${city.state}`, key = clean(label);
  if (!unique.has(key)) unique.set(key, { label, city: city.name, state: city.state, aliases: [...new Set([city.name, ...city.aliases, ...(cityAliases[city.name] ?? [])])], population: city.population });
}
export const INDIA_LOCATIONS = [...unique.values()];
const exactLocations = new Map(INDIA_LOCATIONS.map(option => [clean(option.label), option]));
const aliases = new Map<string, LocationOption[]>();
for (const option of INDIA_LOCATIONS) for (const alias of option.aliases) {
  const key = clean(alias); aliases.set(key, [...(aliases.get(key) ?? []), option]);
}
const searchable = INDIA_LOCATIONS.map(option => ({ option, tokens: clean([option.label, ...option.aliases, ...(stateCodes[option.state] ?? [])].join(" ")).split(" ") }));
export function locationSuggestions(query: string, limit = 12): LocationOption[] {
  const words = clean(query).split(" ").filter(Boolean);
  const results: LocationOption[] = [];
  for (const { option, tokens } of searchable) {
    if (words.every(word => tokens.some(token => token.startsWith(word)))) results.push(option);
    if (results.length >= limit) break;
  }
  return results;
}
export function resolveLocation(value: string): LocationOption | undefined {
  return exactLocations.get(clean(value)) ?? (aliases.get(clean(value))?.length === 1 ? aliases.get(clean(value))![0] : undefined);
}
export function resolveState(value: string) { return stateLookup.get(clean(value)); }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function contains(value: string, term: string) { return new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}])${escape(clean(term))}($|[^\\p{L}\\p{N}\\p{M}])`, "u").test(clean(value)); }
export function locationMatches(value: string, filter: string) {
  const city = resolveLocation(filter);
  if (city) {
    if (!city.aliases.some(alias => contains(value, alias))) return false;
    const explicitStates = value.split(/[,·/|]+/).map(part => stateLookup.get(clean(part))).filter(Boolean);
    return !explicitStates.length || explicitStates.includes(city.state);
  }
  const state = stateLookup.get(clean(filter));
  if (state) return [state, ...(stateCodes[state] ?? [])].some(alias => contains(value, alias)) || value.split(/[,·/|]+/).some(part => {
    const candidates = aliases.get(clean(part));
    return !!candidates?.length && candidates.every(option => option.state === state);
  });
  const parts = filter.split(/[,·/|]+/).map(part => stateLookup.get(clean(part)) ?? clean(part)).filter(Boolean);
  const normalized = value.split(/[,·/|]+/).map(part => stateLookup.get(clean(part)) ?? clean(part)).join(" ");
  return parts.length > 0 && parts.every(part => part.length > 1 && contains(normalized, part));
}

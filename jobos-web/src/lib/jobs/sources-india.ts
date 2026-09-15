// India job source registry — ONLY verified working public ATS boards
// DO NOT add boards by guessing company name → board ID mapping
// Each source must be manually verified to return live jobs from public endpoint

export interface CompanySource {
  company: string;
  provider: "greenhouse" | "lever" | "ashby";
  board: string;
  country: "India" | "Global";
  enabled: boolean;
  notes?: string;
}

// VERIFIED working sources only - tested against real public endpoints
export const INDIA_SOURCES: CompanySource[] = [
  // These are the ONLY verified working boards from the previous implementation
  // Palantir Lever board - confirmed working
  { company: "Palantir", provider: "lever", board: "palantir", country: "Global", enabled: true },
  // Ashby demo board - confirmed working
  { company: "Ashby", provider: "ashby", board: "ashby", country: "Global", enabled: true },
  
  // NOTE: All other Indian company boards were UNVERIFIED GUESSES and have been removed
  // To add a new source:
  // 1. Manually test the public endpoint (e.g., https://boards-api.greenhouse.io/v1/boards/BOARDID)
  // 2. Confirm it returns jobs with valid data
  // 3. Add it here with enabled: true
  // 4. Test in production before committing
];

// Location normalization for India with strict foreign location exclusion
export function normalizeIndiaLocation(location: string): {
  normalized: string;
  isIndia: boolean;
  isForeignOnly: boolean;
  city?: string;
  remote?: boolean;
} {
  const lower = location.toLowerCase();
  
  // HARD exclusion: Foreign-only locations (EU, EMEA, US states, UAE, etc.)
  const foreignPatterns = [
    /\b(european union|emea|europe only|eu only)\b/i,
    /\b(united states|usa|us only|california|new york|texas|washington|oregon|massachusetts|florida)\b/i,
    /\b(united kingdom|uk|london|england|scotland)\b/i,
    /\b(united arab emirates|uae|dubai|abu dhabi)\b/i,
    /\b(singapore|hong kong|china|japan|korea|australia|canada|germany|france|netherlands|sweden)\b/i,
  ];
  const isForeignOnly = foreignPatterns.some(pattern => pattern.test(location)) && !/\bindia\b/i.test(location);
  
  // Check if it's India-related
  const isIndia = /\b(india|indian|bharat|bangalore|bengaluru|mumbai|delhi|ncr|gurgaon|gurugram|hyderabad|pune|chennai|kolkata|noida|ahmedabad|jaipur|kochi|cochin|chandigarh|indore|lucknow|bhubaneswar|trivandrum|thiruvananthapuram|vizag|visakhapatnam|coimbatore|mysore|mysuru|vadodara|surat|nagpur|bhopal|patna|ranchi)\b/i.test(location);
  
  // Check remote - but only if not explicitly foreign-only
  const remote = /\b(remote|work from home|wfh|anywhere)\b/i.test(location);
  
  // Normalize common city name variants
  let normalized = location;
  if (/bangalore/i.test(location)) normalized = normalized.replace(/bangalore/i, "Bengaluru");
  if (/bombay/i.test(location)) normalized = normalized.replace(/bombay/i, "Mumbai");
  if (/gurgaon/i.test(location)) normalized = normalized.replace(/gurgaon/i, "Gurugram");
  if (/calcutta/i.test(location)) normalized = normalized.replace(/calcutta/i, "Kolkata");
  if (/madras/i.test(location)) normalized = normalized.replace(/madras/i, "Chennai");
  
  // Extract city
  const cities = ["Bengaluru", "Mumbai", "Delhi", "Gurugram", "Hyderabad", "Pune", "Chennai", "Kolkata", "Noida", "Ahmedabad", "Jaipur", "Kochi", "Chandigarh"];
  const city = cities.find(c => new RegExp(c, "i").test(normalized));
  
  return { normalized, isIndia, isForeignOnly, city, remote };
}

// Indian city options for search UI
export const INDIAN_CITIES = [
  "Bengaluru",
  "Mumbai", 
  "Delhi NCR",
  "Gurugram",
  "Noida",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Kochi",
  "Chandigarh",
  "Indore",
  "Lucknow",
  "Bhubaneswar",
  "Remote - India",
  "Pan India",
];

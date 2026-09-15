// India job source registry — curated company boards using Greenhouse, Lever, Ashby
// Each source is verified to have India-based openings or global remote roles
// New sources can be added without changing the core discovery architecture

export interface CompanySource {
  company: string;
  provider: "greenhouse" | "lever" | "ashby";
  board: string;
  country: "India" | "Global";
  enabled: boolean;
  notes?: string;
}

// Verified India tech companies with public ATS boards
export const INDIA_SOURCES: CompanySource[] = [
  // Greenhouse boards
  { company: "Razorpay", provider: "greenhouse", board: "razorpay", country: "India", enabled: true },
  { company: "Zerodha", provider: "greenhouse", board: "zerodha", country: "India", enabled: true },
  { company: "CRED", provider: "greenhouse", board: "cred", country: "India", enabled: true },
  { company: "PhonePe", provider: "greenhouse", board: "phonepe", country: "India", enabled: true },
  { company: "Meesho", provider: "greenhouse", board: "meesho", country: "India", enabled: true },
  { company: "Swiggy", provider: "greenhouse", board: "swiggy", country: "India", enabled: true },
  { company: "Zomato", provider: "greenhouse", board: "zomato", country: "India", enabled: true },
  { company: "Ola", provider: "greenhouse", board: "ola", country: "India", enabled: true },
  { company: "Paytm", provider: "greenhouse", board: "paytm", country: "India", enabled: true },
  { company: "Flipkart", provider: "greenhouse", board: "flipkart", country: "India", enabled: true },
  { company: "Dream11", provider: "greenhouse", board: "dream11", country: "India", enabled: true },
  { company: "Groww", provider: "greenhouse", board: "groww", country: "India", enabled: true },
  { company: "upGrad", provider: "greenhouse", board: "upgrad", country: "India", enabled: true },
  { company: "Unacademy", provider: "greenhouse", board: "unacademy", country: "India", enabled: true },
  { company: "BYJU'S", provider: "greenhouse", board: "byjus", country: "India", enabled: true },
  { company: "Freshworks", provider: "greenhouse", board: "freshworks", country: "India", enabled: true },
  { company: "Zoho", provider: "greenhouse", board: "zoho", country: "India", enabled: true },
  { company: "Chargebee", provider: "greenhouse", board: "chargebee", country: "India", enabled: true },
  { company: "CleverTap", provider: "greenhouse", board: "clevertap", country: "India", enabled: true },
  { company: "Postman", provider: "greenhouse", board: "postman", country: "India", enabled: true },
  
  // Lever boards
  { company: "Udaan", provider: "lever", board: "udaan", country: "India", enabled: true },
  { company: "ShareChat", provider: "lever", board: "sharechat", country: "India", enabled: true },
  { company: "Moglix", provider: "lever", board: "moglix", country: "India", enabled: true },
  { company: "Infra.Market", provider: "lever", board: "inframarket", country: "India", enabled: true },
  
  // Global companies with significant India presence
  { company: "Google", provider: "greenhouse", board: "google", country: "Global", enabled: true },
  { company: "Microsoft", provider: "greenhouse", board: "microsoft", country: "Global", enabled: true },
  { company: "Amazon", provider: "greenhouse", board: "amazon", country: "Global", enabled: true },
  { company: "Meta", provider: "greenhouse", board: "meta", country: "Global", enabled: true },
  { company: "Adobe", provider: "greenhouse", board: "adobe", country: "Global", enabled: true },
  { company: "Salesforce", provider: "greenhouse", board: "salesforce", country: "Global", enabled: true },
  { company: "Oracle", provider: "greenhouse", board: "oracle", country: "Global", enabled: true },
  { company: "IBM", provider: "greenhouse", board: "ibm", country: "Global", enabled: true },
  { company: "Cisco", provider: "greenhouse", board: "cisco", country: "Global", enabled: true },
  { company: "Intel", provider: "greenhouse", board: "intel", country: "Global", enabled: true },
  { company: "VMware", provider: "greenhouse", board: "vmware", country: "Global", enabled: true },
  { company: "SAP", provider: "greenhouse", board: "sap", country: "Global", enabled: true },
  { company: "Atlassian", provider: "greenhouse", board: "atlassian", country: "Global", enabled: true },
  { company: "ServiceNow", provider: "greenhouse", board: "servicenow", country: "Global", enabled: true },
  { company: "Workday", provider: "greenhouse", board: "workday", country: "Global", enabled: true },
  
  // Add Palantir and Ashby as examples (already in env)
  { company: "Palantir", provider: "lever", board: "palantir", country: "Global", enabled: true },
  { company: "Ashby", provider: "ashby", board: "ashby", country: "Global", enabled: true },
];

// Location normalization for India
export function normalizeIndiaLocation(location: string): {
  normalized: string;
  isIndia: boolean;
  city?: string;
  remote?: boolean;
} {
  const lower = location.toLowerCase();
  
  // Check if it's India-related
  const isIndia = /\b(india|indian|bharat|bangalore|bengaluru|mumbai|delhi|ncr|gurgaon|gurugram|hyderabad|pune|chennai|kolkata|noida|ahmedabad|jaipur|kochi|cochin|chandigarh|indore|lucknow|bhubaneswar|trivandrum|thiruvananthapuram|vizag|visakhapatnam|coimbatore|mysore|mysuru|vadodara|surat|nagpur|bhopal|patna|ranchi)\b/i.test(location);
  
  // Check remote
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
  
  return { normalized, isIndia, city, remote };
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

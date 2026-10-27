import { INDIA_SOURCES } from "./sources-india.ts";

export interface CompanyOption { name: string; aliases: string[]; careerUrl?: string; connected: boolean }
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(limited|ltd|private|pvt|inc|corporation)\b/g, "").replace(/\s+/g, " ").trim();
// Search vocabulary only. A company name is never evidence of an imported vacancy.
const directory = ["Google", "Amazon", "Deloitte", "Wipro", "Infosys", "TCS", "Accenture", "Microsoft", "IBM", "Cognizant", "Capgemini", "HCLTech", "Tech Mahindra", "LTIMindtree", "Mphasis", "Persistent Systems", "Oracle", "SAP", "Salesforce", "Adobe", "Cisco", "Intel", "NVIDIA", "Qualcomm", "Samsung", "Apple", "Walmart", "Flipkart", "Meesho", "Myntra", "Reliance Industries", "Reliance Retail", "Jio", "Airtel", "Vodafone Idea", "Tata Motors", "Tata Steel", "Tata Power", "Tata Consumer Products", "Titan", "Mahindra", "Maruti Suzuki", "Hyundai", "Bajaj Auto", "Hero MotoCorp", "TVS Motor", "Ashok Leyland", "Larsen & Toubro", "Adani Group", "JSW", "Vedanta", "Hindalco", "UltraTech Cement", "Asian Paints", "Berger Paints", "Hindustan Unilever", "ITC", "Nestlé India", "Britannia", "Dabur", "Marico", "Godrej", "P&G", "PepsiCo", "Coca-Cola", "Mondelez", "Amul", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "SBI", "IndusInd Bank", "IDFC FIRST Bank", "Bajaj Finance", "JPMorgan Chase", "Goldman Sachs", "Morgan Stanley", "HSBC", "Barclays", "Deutsche Bank", "Citi", "Standard Chartered", "American Express", "Visa", "Mastercard", "PayPal", "PhonePe", "Paytm", "Razorpay", "Zerodha", "Groww", "Swiggy", "Zomato", "Zepto", "Blinkit", "BigBasket", "Delhivery", "Blue Dart", "DHL", "FedEx", "Maersk", "DP World", "IndiGo", "Air India", "Akasa Air", "Taj Hotels", "Marriott", "Hyatt", "Hilton", "Oberoi", "OYO", "MakeMyTrip", "Sun Pharma", "Cipla", "Lupin", "Aurobindo Pharma", "Biocon", "Zydus Lifesciences", "Torrent Pharma", "Glenmark", "Abbott", "Pfizer", "Novartis", "AstraZeneca", "GSK", "Sanofi", "Roche", "Bayer", "Apollo Hospitals", "Fortis Healthcare", "Max Healthcare", "Manipal Hospitals", "Medanta", "Siemens", "Schneider Electric", "ABB", "Honeywell", "GE", "Hitachi", "Cummins", "Caterpillar", "John Deere", "Eaton", "Rockwell Automation", "3M", "Emerson", "KPMG", "EY", "PwC", "Grant Thornton", "BDO", "McKinsey", "BCG", "Bain", "Gartner", "Genpact", "EXL", "WNS", "Concentrix", "Teleperformance", "Sutherland", "Foundever", "Firstsource", "Nagarro", "EPAM", "Globant", "Thoughtworks", "Zscaler", "Atlassian", "Uber", "Airbnb", "Booking.com", "LinkedIn", "Indeed", "Naukri", "Info Edge", "BYJU’S", "Unacademy", "upGrad", "Physics Wallah", "Vedantu", "LEAD", "Decathlon", "H&M", "IKEA", "DMart", "Trent", "Shoppers Stop", "Nykaa", "Lenskart", "Urban Company", "Quess", "TeamLease", "Randstad", "Adecco", "ManpowerGroup"];
const known: Record<string, { aliases: string[]; careerUrl?: string }> = {
  Google: { aliases: ["Alphabet", "Google India"], careerUrl: "https://www.google.com/about/careers/applications/jobs/results/" },
  Amazon: { aliases: ["AWS", "Amazon Web Services", "ADCI", "Amazon India"], careerUrl: "https://www.amazon.jobs/en/search?country%5B%5D=IND" },
  Deloitte: { aliases: ["Deloitte India", "Deloitte USI"], careerUrl: "https://southasiacareers.deloitte.com/" },
  Wipro: { aliases: ["Wipro Limited"], careerUrl: "https://careers.wipro.com/" },
  Infosys: { aliases: ["Infosys Limited", "Infosys BPM"], careerUrl: "https://career.infosys.com/jobs?countrycode=IN" },
  TCS: { aliases: ["Tata Consultancy Services"] }, HCLTech: { aliases: ["HCL", "HCL Technologies"] },
  "Larsen & Toubro": { aliases: ["L&T", "Larsen and Toubro"] }, "P&G": { aliases: ["Procter & Gamble"] },
  "Dr Reddy's Laboratories": { aliases: ["Dr Reddy", "Dr Reddys", "Dr. Reddy's"] }, NielsenIQ: { aliases: ["NIQ", "Nielsen IQ"] },
};
export function companyDirectory(listed: string[] = []): CompanyOption[] {
  const all = new Map<string, CompanyOption>();
  for (const name of [...directory, ...INDIA_SOURCES.filter(source => source.enabled).map(source => source.company), ...listed]) {
    const id = key(name); if (!id || all.has(id)) continue;
    all.set(id, { name, aliases: known[name]?.aliases ?? [], careerUrl: known[name]?.careerUrl,
      connected: INDIA_SOURCES.some(source => source.enabled && key(source.company) === id) || listed.some(value => key(value) === id) });
  }
  return [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function companySuggestions(query: string, listed: string[] = [], limit = 10): CompanyOption[] {
  const q = key(query); return companyDirectory(listed).filter(company => !q || [company.name, ...company.aliases].some(value => key(value).includes(q)))
    .sort((a, b) => Number(!key(a.name).startsWith(q)) - Number(!key(b.name).startsWith(q)) || a.name.localeCompare(b.name)).slice(0, limit);
}
export function findCompany(query: string, listed: string[] = []) { return companyDirectory(listed).find(company => [company.name, ...company.aliases].some(value => key(value) === key(query))); }
export function matchesCompany(company: string, query: string) {
  if (!query.trim()) return true;
  const selected = findCompany(query);
  return [selected?.name ?? query, ...(selected?.aliases ?? [])].some(value => key(company).includes(key(value)));
}

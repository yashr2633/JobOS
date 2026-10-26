import type { Job } from "./types.ts";

// Search vocabulary, not vacancies or claims that a role is currently hiring.
const roles = ["Data Analyst", "Data Scientist", "Data Engineer", "Data Entry Operator", "Database Administrator", "Business Analyst", "Business Development Executive", "Business Development Manager", "Sales Executive", "Sales Representative", "Inside Sales Executive", "Field Sales Executive", "Sales Manager", "Retail Sales Associate", "Account Executive", "Accountant", "Accounts Assistant", "Finance Analyst", "Financial Analyst", "Loan Officer", "Banking Associate", "Operations Analyst", "Operations Executive", "MIS Executive", "MIS Analyst", "Customer Support Executive", "Customer Service Associate", "Call Centre Executive", "Technical Support Engineer", "Software Engineer", "Software Developer", "Frontend Developer", "Backend Developer", "Full Stack Developer", "Python Developer", "Java Developer", "SQL Developer", "Web Developer", "Mobile App Developer", "QA Engineer", "Software Tester", "DevOps Engineer", "Cloud Engineer", "Cybersecurity Analyst", "IT Support Engineer", "Network Engineer", "Product Manager", "Project Manager", "Program Manager", "UI Designer", "UX Designer", "Graphic Designer", "Digital Marketing Executive", "Marketing Executive", "Content Writer", "SEO Executive", "Social Media Manager", "HR Executive", "Recruiter", "Talent Acquisition Specialist", "Payroll Executive", "Administrative Assistant", "Office Assistant", "Receptionist", "Front Office Executive", "Real Estate Sales Executive", "Property Consultant", "Civil Engineer", "Mechanical Engineer", "Electrical Engineer", "Production Engineer", "Quality Engineer", "Production Supervisor", "Maintenance Technician", "Electrician", "Warehouse Executive", "Store Manager", "Inventory Executive", "Logistics Coordinator", "Supply Chain Analyst", "Delivery Executive", "Driver", "Security Guard", "Nurse", "Pharmacist", "Medical Officer", "Lab Technician", "Teacher", "Tutor", "Counsellor", "Hotel Manager", "Restaurant Manager", "Chef", "Housekeeping Associate", "Graduate Trainee", "Management Trainee", "Intern"];
export interface SearchSuggestion { value: string; kind: "Role" | "Skill" | "Company" | "Listed role" }
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
const roleQueries = new Set(roles.map(normalize));
export function isRoleQuery(query: string) { return roleQueries.has(normalize(query)); }
export function buildSearchVocabulary(jobs: Pick<Job, "title" | "company" | "skills">[]): SearchSuggestion[] {
  const seen = new Set<string>(), result: SearchSuggestion[] = [];
  const add = (value: string, kind: SearchSuggestion["kind"]) => {
    value = value.trim(); const key = normalize(value);
    if (!key || seen.has(key) || value.length > 120) return;
    seen.add(key); result.push({ value, kind });
  };
  roles.forEach(role => add(role, "Role"));
  for (const skill of ["SQL", "Python", "Power BI", "Excel", "Tableau", "Java", "JavaScript", "React", "Accounting", "Communication"]) add(skill, "Skill");
  for (const job of jobs) { add(job.title, "Listed role"); add(job.company, "Company"); job.skills.forEach(skill => add(skill, "Skill")); }
  return result;
}
export function searchSuggestions(vocabulary: SearchSuggestion[], query: string, limit = 10): SearchSuggestion[] {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return roles.slice(0, 8).map(value => ({ value, kind: "Role" }));
  return vocabulary.filter(item => { const tokens = normalize(item.value).split(" "); return words.every(word => tokens.some(token => token.startsWith(word))); })
    .sort((a, b) => Number(!normalize(a.value).startsWith(normalize(query))) - Number(!normalize(b.value).startsWith(normalize(query))) ||
      (["Role", "Listed role", "Skill", "Company"].indexOf(a.kind) - ["Role", "Listed role", "Skill", "Company"].indexOf(b.kind))).slice(0, limit);
}
export function publicJobQuery(value: string) {
  const query = value.trim().slice(0, 120);
  return !query || /[@<>]|https?:|\b\d{8,}\b/i.test(query) || !/^[\p{L}\p{N}\p{M}\s&/+.#(),'-]+$/u.test(query) ? "" : query;
}

import { publicJobQuery } from "./searchSuggestions.ts";
export interface JobFilters { q: string; company: string; location: string; experience: string; mode: string; days: string; assistant: boolean; resume?: string }
export function readJobFilters(value: Record<string, unknown>): JobFilters {
  const text = (key: string) => typeof value[key] === "string" ? (value[key] as string).trim() : "";
  const q = publicJobQuery(text("q")), rawCompany = text("company"), company = rawCompany.length <= 100 ? publicJobQuery(rawCompany) : "";
  return { q, company, location: text("location").slice(0, 100) || "India",
    experience: ["entry", "0", "2", "3", "5", "10", "unknown"].includes(text("experience")) ? text("experience") : "",
    mode: ["Remote", "Hybrid", "On-site"].includes(text("mode")) ? text("mode") : "",
    days: typeof value.days === "string" && ["", "1", "3", "7", "14", "30", "90", "180"].includes(text("days")) ? text("days") : "30",
    assistant: text("assistant") === "1" && !!(q || company),
    resume: /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(text("resume")) ? text("resume") : undefined };
}

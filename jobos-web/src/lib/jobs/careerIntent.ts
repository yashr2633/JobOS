import { publicJobQuery } from "./searchSuggestions.ts";
import { findCompany } from "./companies.ts";
import { resolveLocation, resolveState } from "./locations.ts";
export interface CareerIntent { role: string; company: string; location: string; experience: string; mode: string; days: string; qualification?: string }
export const EMPTY_INTENT: CareerIntent = { role: "", company: "", location: "India", experience: "", mode: "", days: "30" };
export function publicCareerMessage(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.length <= 400
    && !/[@<>]|https?:|\b\d{8,}\b/i.test(value) && /^[\p{L}\p{N}\p{M}\s&/+.#(),?!:'’"-]+$/u.test(value);
}
export function validateCareerIntent(raw: unknown): CareerIntent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (["role", "company", "location", "experience", "mode", "days"].some(key => typeof value[key] !== "string")) return null;
  const role = (value.role as string).trim(), company = (value.company as string).trim(), location = (value.location as string).trim();
  if (role.length > 80 || company.length > 100 || location.length > 100 || (role && !publicJobQuery(role)) || (company && !publicJobQuery(company))) return null;
  if (!["", "entry", "3", "5", "10", "unknown"].includes(value.experience as string) || !["", "Remote", "Hybrid", "On-site"].includes(value.mode as string) || !["", "1", "3", "7", "14", "30", "90", "180"].includes(value.days as string)) return null;
  if (value.qualification !== undefined && !["", "BBA", "BCom", "MBA", "BTech", "Graduate"].includes(value.qualification as string)) return null;
  const normalized = /^(india|anywhere in india|all india|pan india)$/i.test(location) ? "India" : resolveState(location) ?? resolveLocation(location)?.label;
  if (!normalized) return null;
  return { role, company: findCompany(company)?.name ?? company, location: normalized, experience: value.experience as string, mode: value.mode as string, days: value.days as string, ...(value.qualification ? { qualification: value.qualification as string } : {}) };
}
export function careerSearchUrl(intent: CareerIntent, resumeId?: string | null) {
  const params = new URLSearchParams({ assistant: "1", location: intent.location });
  if (intent.role) params.set("q", intent.role);
  if (intent.company) params.set("company", intent.company);
  if (intent.experience) params.set("experience", intent.experience);
  if (intent.mode) params.set("mode", intent.mode);
  if (intent.qualification) params.set("qualification", intent.qualification);
  params.set("days", intent.days);
  if (resumeId && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(resumeId)) params.set("resume", resumeId);
  return `/jobs?${params}`;
}
export function experienceMatches(minimum: number | null, filter: string) {
  if (!filter) return true;
  if (filter === "unknown") return minimum === null;
  if (filter === "entry") return minimum === null || minimum <= 0;
  return minimum === null || minimum <= Number(filter);
}

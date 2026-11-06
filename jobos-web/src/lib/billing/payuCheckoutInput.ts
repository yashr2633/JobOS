import { isBillingPlan, type BillingPlan } from "./plans.ts";

export function normalizeIndianMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let phone = value.normalize("NFKC").replace(/[\s().\-\u200B-\u200D\uFEFF]/g, "");
  if (phone.startsWith("+91")) phone = phone.slice(3);
  else if (/^0091\d{10}$/.test(phone)) phone = phone.slice(4);
  else if (/^91\d{10}$/.test(phone)) phone = phone.slice(2);
  else if (/^0\d{10}$/.test(phone)) phone = phone.slice(1);
  return /^[6-9]\d{9}$/.test(phone) ? phone : null;
}
type CheckoutInput = { plan: BillingPlan; firstname: string; phone: string; purchaseConsent: true };
type Validation = { ok: true; value: CheckoutInput } | { ok: false; field: "plan" | "firstname" | "phone" | "purchaseConsent"; error: string };
export function validatePayUCheckout(body: unknown): Validation {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!isBillingPlan(input.plan)) return { ok: false, field: "plan", error: "Choose the Monthly or Yearly plan again." };
  const name = typeof input.firstname === "string" ? input.firstname.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/gu, " ").trim() : "";
  if (!/^[\p{L}\p{M}\p{N} .,'’()\-]{1,70}$/u.test(name) || !/\p{L}/u.test(name)) return { ok: false, field: "firstname", error: "Enter your name using letters, spaces or common name punctuation (up to 70 characters)." };
  const phone = normalizeIndianMobile(input.phone);
  if (!phone) return { ok: false, field: "phone", error: "Enter a valid 10-digit Indian mobile number. +91 and 91 prefixes are also accepted." };
  if (input.purchaseConsent !== true) return { ok: false, field: "purchaseConsent", error: "Tick the one-time purchase agreement before continuing to PayU." };
  return { ok: true, value: { plan: input.plan, firstname: name, phone, purchaseConsent: true } };
}

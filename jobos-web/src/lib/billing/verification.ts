import { createHmac, timingSafeEqual } from "node:crypto";
import { BILLING_PLANS, type BillingPlan } from "./plans.ts";

export function validSignature(message: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", secret).update(message).digest());
}
export const providerId = (value: unknown, prefix: string): value is string => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{6,40}$`).test(value);
export interface ProviderSubscription {
  id: string; plan_id: string; status: string; current_start: number | null; current_end: number | null;
  notes?: Record<string, string>; paid_count?: number;
}
export interface ProviderPayment {
  id: string; invoice_id: string | null; status: string; captured: boolean; amount: number;
  currency: string; amount_refunded?: number; created_at: number;
}
export interface ProviderInvoice {
  id: string; subscription_id: string; payment_id: string; status: string; amount_paid: number;
  currency: string; billing_start: number | null; billing_end: number | null;
}
/** Only a captured payment for this subscription's paid invoice creates access. */
export function verifiedPurchase(plan: BillingPlan, subscription: ProviderSubscription, payment: ProviderPayment, invoice: ProviderInvoice, expectedPlanId: string) {
  const price = BILLING_PLANS[plan];
  if (!Number.isSafeInteger(payment.created_at) || payment.created_at <= 0) return null;
  if (subscription.plan_id !== expectedPlanId || subscription.notes?.app !== "jobtrackos" ||
    payment.status !== "captured" || payment.captured !== true || payment.amount !== price.amount || payment.currency !== "INR" ||
    (payment.amount_refunded ?? 0) >= payment.amount || invoice.status !== "paid" || invoice.amount_paid !== price.amount || invoice.currency !== "INR" ||
    payment.invoice_id !== invoice.id || invoice.payment_id !== payment.id || invoice.subscription_id !== subscription.id) return null;
  const start = invoice.billing_start ?? subscription.current_start;
  const end = invoice.billing_end ?? subscription.current_end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !start || !end || start <= 0 || end <= start) return null;
  const days = (end - start) / 86400;
  if (days < (plan === "monthly" ? 25 : 360) || days > (plan === "monthly" ? 35 : 370)) return null;
  // When an invoice has no period fields, never attach an old payment to a newer cycle.
  if ((!invoice.billing_start || !invoice.billing_end) && (payment.created_at < start - 300 || payment.created_at >= end)) return null;
  return { amount: price.amount, paidAt: new Date(payment.created_at * 1000).toISOString(), validUntil: new Date(end * 1000).toISOString() };
}

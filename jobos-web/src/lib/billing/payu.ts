import "server-only";
import { randomUUID } from "node:crypto";
import { billingDatabase } from "./server";
import { BILLING_PLANS, BILLING_SUPPORT_EMAIL, formatInr, type BillingPlan } from "./plans";
import { SITE_ORIGIN } from "@/lib/seo/metadata";
import { capturedPayUPayment, payuCommandHash, payuRequestHash, validPayUResponse, type PayUFields, type PayUTransaction } from "./payuVerification";

export const payuMode = () => process.env.PAYU_MODE === "test" ? "test" : "live";
export function payuReady() {
  return process.env.PAYU_CHECKOUT_ENABLED === "true" && !!process.env.PAYU_MERCHANT_KEY?.trim() &&
    !!process.env.PAYU_MERCHANT_SALT?.trim() && !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.VERCEL_ENV !== "production" || payuMode() === "live");
}
type Checkout = { txnid: string; user_id: string; plan_key: BillingPlan; mode: string; amount: number; email: string; firstname: string; phone: string; productinfo: string; status: string; provider_payment_id: string | null; valid_until: string | null };
function credentials() {
  const key = process.env.PAYU_MERCHANT_KEY?.trim(), salt = process.env.PAYU_MERCHANT_SALT?.trim();
  if (!key || !salt) throw new Error("PayU setup is incomplete.");
  return { key, salt };
}
function fieldsFor(row: Checkout) {
  const { key, salt } = credentials();
  const fields: PayUFields = { key, txnid: row.txnid, amount: (row.amount / 100).toFixed(2), productinfo: row.productinfo,
    firstname: row.firstname, email: row.email, phone: row.phone,
    surl: `${SITE_ORIGIN}/api/billing/payu/return`, furl: `${SITE_ORIGIN}/api/billing/payu/return` };
  return { action: payuMode() === "test" ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment", fields: { ...fields, hash: payuRequestHash(fields, salt) } };
}
export async function createPayUCheckout(user: { id: string; email?: string }, plan: BillingPlan, firstname: string, phone: string) {
  if (!payuReady()) throw new Error("Payments are being enabled. Please check back shortly.");
  if (!user.email || !/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(user.email)) throw new Error("A verified account email is required.");
  const db = billingDatabase();
  const { data: token, error } = await db.rpc("claim_billing_checkout", { p_user_id: user.id });
  if (error || !token) throw new Error("Another checkout request is running. Please wait a moment.");
  try {
    const access = await db.rpc("billing_access_until", { p_user_id: user.id });
    if (access.error) throw new Error("Your paid access could not be checked.");
    if (access.data) throw new Error("You already have active paid access. Check your account before paying again.");
    const pending = await db.from("billing_payu_checkouts").select("*").eq("user_id", user.id).eq("plan_key", plan).eq("mode", payuMode()).eq("status", "pending").maybeSingle();
    if (pending.error) throw new Error("Your existing checkout could not be checked.");
    if (pending.data) return fieldsFor(pending.data as Checkout);
    const row = { txnid: `jt${randomUUID().replaceAll("-", "")}`, user_id: user.id, plan_key: plan, mode: payuMode(),
      amount: BILLING_PLANS[plan].amount, email: user.email, firstname, phone, productinfo: `JobTrackOS Pro ${plan}` };
    const saved = await db.from("billing_payu_checkouts").insert(row).select("*").single();
    if (saved.error) throw new Error("Checkout could not be saved. Please retry.");
    return fieldsFor(saved.data as Checkout);
  } finally { await db.from("billing_locks").delete().eq("user_id", user.id).eq("token", token); }
}
async function verifyProvider(row: Checkout): Promise<PayUTransaction | null> {
  const { key, salt } = credentials();
  const command = "verify_payment";
  const response = await fetch(payuMode() === "test" ? "https://test.payu.in/merchant/postservice.php?form=2" : "https://info.payu.in/merchant/postservice.php?form=2", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key, command, var1: row.txnid, hash: payuCommandHash(key, command, row.txnid, salt) }),
  });
  if (!response.ok) throw new Error("PayU verification is temporarily unavailable.");
  const body = await response.json();
  const transaction = body.transaction_details?.[row.txnid];
  if (!transaction) throw new Error("PayU could not verify this transaction yet.");
  return transaction;
}
async function settle(row: Checkout) {
  if (row.mode !== payuMode()) throw new Error("Payment environment mismatch.");
  const remote = await verifyProvider(row);
  if (!remote) return false;
  const paymentId = capturedPayUPayment(row, remote);
  if (!paymentId) {
    if (remote.status === "failure" && ["failed", "bounced", "dropped", "usercancelled"].includes(remote.unmappedstatus ?? "")) {
      const failed = await billingDatabase().from("billing_payu_checkouts").update({ status: "failed" }).eq("txnid", row.txnid).eq("status", "pending");
      if (failed.error) throw new Error("Payment status could not be saved.");
    }
    return false;
  }
  const result = await billingDatabase().rpc("confirm_payu_purchase", { p_txnid: row.txnid, p_payment_id: paymentId });
  if (result.error) throw new Error("Payment confirmation is pending. Do not pay again; refresh your account.");
  await sendPayUReceipt(row.txnid);
  return true;
}
export async function receivePayU(fields: PayUFields) {
  const { key, salt } = credentials();
  if (!validPayUResponse(fields, key, salt)) return { valid: false, confirmed: false };
  const found = await billingDatabase().from("billing_payu_checkouts").select("*").eq("txnid", fields.txnid).maybeSingle();
  if (found.error) throw new Error("Payment lookup unavailable.");
  const row = found.data as Checkout | null;
  if (!row || fields.productinfo !== row.productinfo || fields.firstname !== row.firstname || fields.email !== row.email || fields.amount !== (row.amount / 100).toFixed(2)) return { valid: false, confirmed: false };
  if (row.status === "paid") return { valid: true, confirmed: true };
  const confirmed = await settle(row);
  // A success notification can arrive before the verification API catches up; request a retry, never silently drop it.
  if (fields.status === "success" && !confirmed) throw new Error("Payment confirmation pending. Retry notification.");
  return { valid: true, confirmed };
}
export async function reconcilePayU(userId: string) {
  const rows = await billingDatabase().from("billing_payu_checkouts").select("*").eq("user_id", userId).eq("mode", payuMode()).in("status", ["pending", "paid"]).order("created_at", { ascending: false }).limit(3);
  if (rows.error) throw new Error("Payments could not be loaded.");
  for (const row of rows.data ?? []) await settle(row as Checkout);
}
async function sendPayUReceipt(txnid: string) {
  if (!process.env.BREVO_API_KEY || !process.env.JOB_ALERT_FROM_EMAIL) return;
  const db = billingDatabase();
  const claimed = await db.from("billing_payu_checkouts").update({ email_status: "sending" }).eq("txnid", txnid).eq("status", "paid").eq("mode", "live").eq("email_status", "pending").select("email,amount,plan_key,valid_until,provider_payment_id").maybeSingle();
  if (claimed.error || !claimed.data) return;
  const p = claimed.data;
  let state = "unknown";
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", signal: AbortSignal.timeout(10000), headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { name: "JobTrackOS", email: process.env.JOB_ALERT_FROM_EMAIL }, replyTo: { name: "JobTrackOS Support", email: BILLING_SUPPORT_EMAIL }, to: [{ email: p.email }], subject: "Your JobTrackOS Pro payment is confirmed", headers: { IdempotencyKey: `payu-${txnid}` }, textContent: `Your ${formatInr(p.amount)} payment is confirmed. JobTrackOS Pro access through ${new Date(p.valid_until).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}. Payment reference: ${p.provider_payment_id}. This is a one-time purchase, with no automatic renewal. Open your tools and payment history: https://www.jobtrackos.online/plans`, htmlContent: `<html><body style="margin:0;padding:24px;background:#edf6f0;font-family:Arial,sans-serif;color:#09251c"><div style="max-width:580px;margin:auto;background:white;border:1px solid #c8dbdc;border-radius:12px;overflow:hidden"><div style="padding:24px;background:#09251c;color:white"><img src="https://www.jobtrackos.online/brand-logo.png" width="44" height="44" alt="JobTrackOS"><h1 style="font-size:25px">Your Pro access is ready</h1></div><div style="padding:24px"><p>Payment confirmed: <strong>${formatInr(p.amount)}</strong></p><p>Access through ${new Date(p.valid_until).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.</p><p>60+ Premium designs, recruiter contact access and personal outreach drafts are ready in your workspace.</p><p>One-time purchase. No automatic renewal.</p><p style="font-size:12px">PayU reference: ${p.provider_payment_id}</p><a href="https://www.jobtrackos.online/plans" style="display:inline-block;padding:14px 22px;background:#60c1e5;color:#09251c;text-decoration:none;border-radius:7px;font-weight:bold">Open JobTrackOS</a><p>Support: ${BILLING_SUPPORT_EMAIL}</p></div></div></body></html>` }) });
    state = response.ok ? "sent" : response.status < 500 ? "failed" : "unknown";
  } catch { /* An uncertain send is held rather than duplicated. */ }
  await db.from("billing_payu_checkouts").update({ email_status: state }).eq("txnid", txnid).eq("email_status", "sending");
}

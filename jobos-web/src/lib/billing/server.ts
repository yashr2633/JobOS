import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { BILLING_PLANS, BILLING_SUPPORT_EMAIL, formatInr, isBillingPlan, type BillingPlan } from "./plans";
import { providerId, verifiedPurchase, type ProviderInvoice, type ProviderPayment, type ProviderSubscription } from "./verification";

export function billingDatabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Billing is not configured.");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function billingMode() { return process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "live" : "test"; }
export function billingReady() {
  return process.env.RAZORPAY_CHECKOUT_ENABLED === "true" && !!process.env.RAZORPAY_KEY_SECRET &&
    !!process.env.RAZORPAY_WEBHOOK_SECRET && !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    /^rzp_(live|test)_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_KEY_ID ?? "") &&
    (process.env.VERCEL_ENV !== "production" || billingMode() === "live");
}
class ProviderError extends Error {
  constructor(public status: number) { super("The payment provider could not complete this request. Please retry shortly."); }
}
export async function razorpay<T>(path: string, body?: unknown): Promise<T> {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Payment setup is incomplete.");
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new ProviderError(response.status);
  return response.json() as Promise<T>;
}
type SubscriptionRow = {
  id: string; user_id: string; plan_key: BillingPlan; mode: string; provider_plan_id: string;
  provider_subscription_id: string | null; status: string; cancel_scheduled: boolean;
};
export async function ownedSubscription(userId: string, checkoutId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(checkoutId)) return null;
  const { data, error } = await billingDatabase().from("billing_subscriptions").select("*").eq("id", checkoutId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Your subscription could not be loaded.");
  return data as SubscriptionRow | null;
}
async function providerPlan(plan: BillingPlan) {
  const db = billingDatabase(), mode = billingMode();
  const { data, error } = await db.from("billing_plan_catalog").select("provider_plan_id").eq("plan_key", plan).eq("mode", mode).maybeSingle();
  if (error) throw new Error("Billing plans could not be loaded.");
  const price = BILLING_PLANS[plan];
  let id: string | undefined = data?.provider_plan_id;
  if (!id) {
    const created = await razorpay<{ id: string }>("plans", { period: price.period, interval: 1,
      item: { name: `JobTrackOS Pro · ${price.name}`, amount: price.amount, currency: "INR", description: "Premium designs, recruiter contacts and personal outreach drafts." }, notes: { app: "jobtrackos" } });
    if (!providerId(created.id, "plan")) throw new Error("Payment plan was not created.");
    const inserted = await db.from("billing_plan_catalog").upsert({ plan_key: plan, mode, provider_plan_id: created.id }, { onConflict: "plan_key,mode", ignoreDuplicates: true });
    if (inserted.error) throw new Error("Payment plan could not be saved.");
    const saved = await db.from("billing_plan_catalog").select("provider_plan_id").eq("plan_key", plan).eq("mode", mode).single();
    if (saved.error) throw new Error("Payment plan could not be loaded.");
    id = saved.data.provider_plan_id;
  }
  const remote = await razorpay<{ period: string; interval: number; item: { amount: number; currency: string } }>(`plans/${id}`);
  if (remote.period !== price.period || remote.interval !== 1 || remote.item.amount !== price.amount || remote.item.currency !== "INR") throw new Error("This billing plan needs review before checkout.");
  return id!;
}
const terminal = new Set(["cancelled", "completed", "expired"]);
const providerStates = new Set(["created", "authenticated", "active", "pending", "halted", "paused", ...terminal]);
async function saveStatus(row: SubscriptionRow, remote: ProviderSubscription) {
  if (remote.id !== row.provider_subscription_id || remote.plan_id !== row.provider_plan_id || remote.notes?.app !== "jobtrackos" || !providerStates.has(remote.status)) throw new Error("Subscription verification failed.");
  const { error } = await billingDatabase().from("billing_subscriptions").update({ status: remote.status, updated_at: new Date().toISOString() }).eq("id", row.id);
  if (error) throw new Error("Subscription status could not be saved.");
}
export async function createCheckout(userId: string, plan: BillingPlan) {
  if (!billingReady()) throw new Error("Payments are being enabled. Please check back shortly.");
  const db = billingDatabase();
  const { data: token, error: lockError } = await db.rpc("claim_billing_checkout", { p_user_id: userId });
  if (lockError) throw new Error("Billing setup is not ready.");
  if (!token) throw new Error("Another checkout request is running. Please wait a moment.");
  try {
    const access = await db.rpc("billing_access_until", { p_user_id: userId });
    if (access.error) throw new Error("Your payment access could not be checked.");
    if (access.data) throw new Error("You already have an active paid period. Manage your subscription below.");
    const pending = await db.from("billing_subscriptions").select("*").eq("user_id", userId).eq("mode", billingMode())
      .in("status", ["creating", "review", "created", "authenticated", "active", "pending", "halted", "paused"]).maybeSingle();
    if (pending.error) throw new Error("Your existing checkout could not be checked.");
    if (pending.data) {
      const row = pending.data as SubscriptionRow;
      if (!row.provider_subscription_id) throw new Error("Your earlier checkout is being checked. Contact support before trying another payment.");
      const remote = await razorpay<ProviderSubscription>(`subscriptions/${row.provider_subscription_id}`);
      await saveStatus(row, remote);
      if (!terminal.has(remote.status)) {
        if (remote.status === "created" && row.plan_key === plan) return checkoutResponse(row);
        if (remote.status !== "created") throw new Error("You have an existing subscription. Check its status below before starting another.");
        await razorpay(`subscriptions/${remote.id}/cancel`, { cancel_at_cycle_end: false });
        const changed = await db.from("billing_subscriptions").update({ status: "cancelled" }).eq("id", row.id);
        if (changed.error) throw new Error("Your old checkout could not be closed.");
      }
    }
    const planId = await providerPlan(plan);
    const reserved = await db.from("billing_subscriptions").insert({ user_id: userId, plan_key: plan, mode: billingMode(), provider_plan_id: planId }).select("*").single();
    if (reserved.error) throw new Error("Checkout could not be reserved. Please retry.");
    const row = reserved.data as SubscriptionRow;
    try {
      const remote = await razorpay<ProviderSubscription>("subscriptions", { plan_id: planId, quantity: 1, total_count: BILLING_PLANS[plan].cycles,
        customer_notify: true, expire_by: Math.floor(Date.now() / 1000) + 3600,
        notes: { app: "jobtrackos", checkout_id: row.id } });
      if (!providerId(remote.id, "sub") || remote.status !== "created") throw new Error("Checkout needs review.");
      const saved = await db.from("billing_subscriptions").update({ provider_subscription_id: remote.id, status: remote.status, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (saved.error) throw new Error("Checkout could not be saved.");
      return checkoutResponse({ ...row, provider_subscription_id: remote.id });
    } catch (error) {
      // An uncertain provider outcome must not silently create a second mandate.
      await db.from("billing_subscriptions").update({ status: error instanceof ProviderError && error.status < 500 ? "failed" : "review" }).eq("id", row.id);
      throw error;
    }
  } finally { await db.from("billing_locks").delete().eq("user_id", userId).eq("token", token); }
}
function checkoutResponse(row: SubscriptionRow) {
  return { checkoutId: row.id, subscriptionId: row.provider_subscription_id, keyId: process.env.RAZORPAY_KEY_ID, plan: row.plan_key };
}
export async function syncPayment(row: SubscriptionRow, paymentId: string) {
  if (!row.provider_subscription_id || !providerId(paymentId, "pay")) throw new Error("Invalid payment reference.");
  const [subscription, payment] = await Promise.all([
    razorpay<ProviderSubscription>(`subscriptions/${row.provider_subscription_id}`), razorpay<ProviderPayment>(`payments/${paymentId}`),
  ]);
  await saveStatus(row, subscription);
  if (payment.id !== paymentId) throw new Error("Payment verification failed.");
  if (!payment.invoice_id || !providerId(payment.invoice_id, "inv")) return false;
  const invoice = await razorpay<ProviderInvoice>(`invoices/${payment.invoice_id}`);
  const purchase = verifiedPurchase(row.plan_key, subscription, payment, invoice, row.provider_plan_id);
  if (!purchase) return false;
  const db = billingDatabase();
  const { error } = await db.from("billing_payments").upsert({ payment_id: payment.id, subscription_id: row.id, user_id: row.user_id,
    mode: row.mode, plan_key: row.plan_key, amount: purchase.amount, paid_at: purchase.paidAt, valid_until: purchase.validUntil }, { onConflict: "payment_id", ignoreDuplicates: true });
  if (error) throw new Error("Payment confirmation could not be saved. Do not pay again; refresh your billing status.");
  await sendReceipt(payment.id);
  return true;
}
export async function sendReceipt(paymentId: string) {
  if (!process.env.BREVO_API_KEY || !process.env.JOB_ALERT_FROM_EMAIL) return;
  const db = billingDatabase();
  const claimed = await db.from("billing_payments").update({ email_status: "sending" }).eq("payment_id", paymentId).eq("mode", "live").eq("email_status", "pending").select("*").maybeSingle();
  if (claimed.error || !claimed.data) return;
  const payment = claimed.data;
  if (payment.mode !== "live" || !isBillingPlan(payment.plan_key)) return;
  let state = "unknown";
  try {
    const { data, error } = await db.auth.admin.getUserById(payment.user_id);
    if (error || !data.user?.email) throw new Error("Receipt recipient unavailable.");
    const price = formatInr(payment.amount), until = new Date(payment.valid_until).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long" });
    const response = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({
        sender: { name: "JobTrackOS", email: process.env.JOB_ALERT_FROM_EMAIL }, replyTo: { name: "JobTrackOS Support", email: BILLING_SUPPORT_EMAIL }, to: [{ email: data.user.email }],
        subject: "Your JobTrackOS Pro payment is confirmed", headers: { IdempotencyKey: `pro-${paymentId}` },
        textContent: `Payment confirmed: ${price}. JobTrackOS Pro (${payment.plan_key}). Paid access through ${until}. Payment reference: ${paymentId}. Premium templates, recruiter contacts and outreach drafts are ready. Manage your subscription: https://www.jobtrackos.online/plans`,
        htmlContent: `<html><body style="background:#edf2f8;font-family:Arial,sans-serif;color:#172338;padding:24px"><div style="max-width:580px;margin:auto;background:white;border:1px solid #c4cede;border-radius:12px;overflow:hidden"><div style="background:#102b55;padding:24px;color:white"><img src="https://www.jobtrackos.online/brand-mark-email.png" width="44" height="44" alt="JobTrackOS"><h1 style="font-size:24px">Welcome to JobTrackOS Pro</h1></div><div style="padding:24px"><p>Your payment of <strong>${price}</strong> is confirmed.</p><p>Paid access through <strong>${until}</strong>.</p><ul><li>64 Premium resume and cover letter designs</li><li>Recruiter work emails</li><li>Personal outreach drafts you review and send</li></ul><p style="font-size:12px">Payment reference: ${paymentId}</p><a href="https://www.jobtrackos.online/plans" style="display:inline-block;padding:14px 20px;background:#204fc4;color:white;text-decoration:none;border-radius:6px">Manage subscription</a><p>Matching job emails are optional. Choose your role, city and frequency in Job Alerts.</p><p>Need help? ${BILLING_SUPPORT_EMAIL}</p></div></div></body></html>`,
      }) });
    state = response.ok ? "sent" : response.status < 500 ? "failed" : "unknown";
  } catch { /* Hold uncertain sends for review rather than sending duplicate receipts. */ }
  await db.from("billing_payments").update({ email_status: state }).eq("payment_id", paymentId).eq("email_status", "sending");
}
export async function cancelSubscription(userId: string, checkoutId: string) {
  const row = await ownedSubscription(userId, checkoutId);
  if (!row?.provider_subscription_id) throw new Error("Subscription not found.");
  const remote = await razorpay<ProviderSubscription>(`subscriptions/${row.provider_subscription_id}`);
  await saveStatus(row, remote);
  if (terminal.has(remote.status)) return;
  const cancelled = await razorpay<ProviderSubscription>(`subscriptions/${remote.id}/cancel`, { cancel_at_cycle_end: !!remote.current_end && remote.current_end > Math.floor(Date.now() / 1000) });
  await saveStatus(row, cancelled);
  const { error } = await billingDatabase().from("billing_subscriptions").update({ cancel_scheduled: true, updated_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", userId);
  if (error) throw new Error("Cancellation was requested. Refresh the status before retrying.");
}
export async function reconcileSubscription(userId: string, checkoutId: string) {
  const row = await ownedSubscription(userId, checkoutId);
  if (!row?.provider_subscription_id) return;
  const remote = await razorpay<ProviderSubscription>(`subscriptions/${row.provider_subscription_id}`);
  await saveStatus(row, remote);
  const from = Math.floor(Date.now() / 1000) - (row.plan_key === "yearly" ? 400 : 45) * 86400;
  const invoices = await razorpay<{ items: ProviderInvoice[] }>(`invoices?subscription_id=${row.provider_subscription_id}&count=100&from=${from}`);
  for (const invoice of invoices.items ?? []) {
    if (invoice.status !== "paid" || invoice.subscription_id !== row.provider_subscription_id || !providerId(invoice.payment_id, "pay")) continue;
    await syncPayment(row, invoice.payment_id);
    const refunds = await razorpay<{ items: { id: string; payment_id: string; amount: number; status: string }[] }>(`payments/${invoice.payment_id}/refunds?count=100`);
    for (const refund of refunds.items ?? []) {
      if (refund.status !== "processed" || refund.payment_id !== invoice.payment_id || !providerId(refund.id, "rfnd") || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) continue;
      const saved = await billingDatabase().from("billing_refunds").upsert({ refund_id: refund.id, payment_id: refund.payment_id, amount: refund.amount }, { onConflict: "refund_id", ignoreDuplicates: true });
      if (saved.error) throw new Error("Refund status could not be refreshed.");
    }
  }
}
export async function processWebhook(event: { event?: string; payload?: { subscription?: { entity?: ProviderSubscription }; payment?: { entity?: ProviderPayment }; refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } } } }, eventId: string) {
  const db = billingDatabase();
  const seen = await db.from("billing_events").select("event_id").eq("event_id", eventId).maybeSingle();
  if (seen.error) throw new Error("Webhook storage unavailable.");
  if (seen.data) return;
  const subscriptionId = event.payload?.subscription?.entity?.id;
  const paymentId = event.payload?.payment?.entity?.id ?? event.payload?.refund?.entity?.payment_id;
  let row: SubscriptionRow | null = null;
  if (providerId(subscriptionId, "sub")) {
    const result = await db.from("billing_subscriptions").select("*").eq("provider_subscription_id", subscriptionId).maybeSingle();
    if (result.error) throw new Error("Subscription lookup failed.");
    row = result.data as SubscriptionRow | null;
  } else if (providerId(paymentId, "pay")) {
    const payment = await razorpay<ProviderPayment>(`payments/${paymentId}`);
    if (payment.invoice_id && providerId(payment.invoice_id, "inv")) {
      const invoice = await razorpay<ProviderInvoice>(`invoices/${payment.invoice_id}`);
      if (providerId(invoice.subscription_id, "sub")) {
        const result = await db.from("billing_subscriptions").select("*").eq("provider_subscription_id", invoice.subscription_id).maybeSingle();
        if (result.error) throw new Error("Subscription lookup failed.");
        row = result.data as SubscriptionRow | null;
      }
    }
  }
  // A shared Razorpay account can also send course events. They do not affect this app.
  if (row && row.mode === billingMode()) {
    const remote = await razorpay<ProviderSubscription>(`subscriptions/${row.provider_subscription_id}`);
    await saveStatus(row, remote);
    if (["subscription.charged", "payment.captured", "invoice.paid", "subscription.authenticated"].includes(event.event ?? "") && providerId(paymentId, "pay")) await syncPayment(row, paymentId);
    const refund = event.payload?.refund?.entity;
    if (event.event === "refund.processed" && refund?.status === "processed" && providerId(refund.id, "rfnd") && providerId(refund.payment_id, "pay") && Number.isSafeInteger(refund.amount) && refund.amount! > 0) {
      const { error } = await db.from("billing_refunds").upsert({ refund_id: refund.id, payment_id: refund.payment_id, amount: refund.amount }, { onConflict: "refund_id", ignoreDuplicates: true });
      if (error) throw new Error("Refund could not be recorded.");
    }
  }
  const stored = await db.from("billing_events").upsert({ event_id: eventId }, { onConflict: "event_id", ignoreDuplicates: true });
  if (stored.error) throw new Error("Webhook receipt could not be saved.");
}

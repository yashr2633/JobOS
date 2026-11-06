"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BILLING_PLANS, BILLING_SUPPORT_EMAIL, formatInr, type BillingPlan } from "@/lib/billing/plans";

import { validatePayUCheckout } from "@/lib/billing/payuCheckoutInput";

type BillingStatus = {
  available: boolean; pro: boolean; paidUntil: string | null;
  latestPaymentStatus?: string | null;
  subscription: { id: string; plan_key: BillingPlan; status: string; cancel_scheduled: boolean } | null;
  payments: { payment_id: string; amount: number; paid_at: string; valid_until: string; email_status: string; refunded?: number }[];
};
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/billing/${path}`, { cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({ error: "The server could not respond. Please retry shortly." }));
  if (!response.ok) throw new Error(result.error || "This request could not finish.");
  return result;
}
const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const benefits = ["60+ Premium resume & cover letter designs", "Customise layouts, typography and page settings", "Edit and export your Premium documents", "Unlock work emails across 3,000+ HR & recruiter contacts", "Personal outreach drafts to review, edit and send", "Resume Match and JD-based tailoring tools included", "All Free features and optional job alerts included"];

export default function PlansContent({ signedIn, initiallyAvailable }: { signedIn: boolean; initiallyAvailable: boolean }) {
  const [plan, setPlan] = useState<BillingPlan>("monthly"), [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null), [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false), [checkoutError, setCheckoutError] = useState("");
  const checkoutDialog = useRef<HTMLDialogElement>(null), continueButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!detailsOpen || !checkoutDialog.current) return;
    const dialog = checkoutDialog.current, returnFocus = continueButton.current, overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLInputElement>('input[name="firstname"]')?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; returnFocus?.focus(); };
  }, [detailsOpen]);
  const [firstname, setFirstname] = useState(""), [phone, setPhone] = useState("");
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    const returningFromPayment = new URL(window.location.href).searchParams.has("payment");
    void fetch("/api/billing/status", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Billing status unavailable.");
      setStatus(body);
      if (returningFromPayment) setMessage(body.pro ? "Your Pro access is active. Check your payment history below." : body.latestPaymentStatus === "failed" ? "Payment did not complete. You can start a new checkout." : "Payment confirmation is pending. If you paid, use Refresh status below; do not pay again.");
    }).catch(error => { if (error.name !== "AbortError") setMessage("Your billing status could not load. Refresh before starting a payment."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [signedIn]);
  async function refresh() {
    setLoading(true);
    try {
      await api("payu/reconcile", {});
      if (status?.subscription) await api("reconcile", { checkoutId: status.subscription.id }).catch(() => {});
      const refreshed = await api("status");
      setStatus(refreshed);
      if (new URL(window.location.href).searchParams.has("payment")) setMessage(refreshed.pro ? "Your Pro access is active. Check your payment history below." : refreshed.latestPaymentStatus === "failed" ? "Payment did not complete. You can start a new checkout." : "Payment confirmation is pending. If you paid, do not pay again.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Status unavailable."); }
    finally { setLoading(false); }
  }
  async function checkout() {
    if (busy) return;
    const checked = validatePayUCheckout({ plan, firstname, phone, purchaseConsent: consent });
    if (!checked.ok) { setCheckoutError(checked.error); checkoutDialog.current?.querySelector<HTMLInputElement>(`[name="${checked.field}"]`)?.focus(); return; }
    setBusy(true); setCheckoutError("");
    try {
      const session = await api("payu/checkout", checked.value);
      if (!["https://secure.payu.in/_payment", "https://test.payu.in/_payment"].includes(session.action) || !session.fields || typeof session.fields !== "object") throw new Error("Invalid secure checkout response.");
      const form = document.createElement("form");
      form.method = "POST"; form.action = session.action;
      for (const [name, value] of Object.entries(session.fields)) {
        if (typeof value !== "string") throw new Error("Invalid payment field.");
        const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input);
      }
      // Keep the form connected until navigation completes; removing it here can cancel the browser POST.
      form.hidden = true;
      document.body.append(form); form.submit();
    } catch (error) { setBusy(false); setCheckoutError(error instanceof Error ? error.message : "Checkout could not open."); }
  }
  async function cancel() {
    if (!status?.subscription || busy) return;
    setBusy(true);
    try { const result = await api("cancel", { checkoutId: status.subscription.id, confirm: true }); setMessage(result.message); setConfirmCancel(false); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation could not be confirmed."); }
    finally { setBusy(false); }
  }
  const available = status?.available ?? initiallyAvailable, price = BILLING_PLANS[plan], subscription = status?.subscription;
  const renewable = subscription && ["authenticated", "active", "pending", "halted", "paused"].includes(subscription.status) && !subscription.cancel_scheduled;
  return <div className="billing-page">
    <section className="billing-intro"><p className="product-kicker">JobTrackOS Pro</p><h1>Increase your chances<br/>of being shortlisted.</h1><p>Tailor your resume and cover letter to the role, and reach relevant recruiters.</p></section>
    <div className="billing-period" role="group" aria-label="Billing period"><button type="button" aria-pressed={plan === "monthly"} onClick={() => { setPlan("monthly"); setConsent(false); }}>Monthly</button><button type="button" aria-pressed={plan === "yearly"} onClick={() => { setPlan("yearly"); setConsent(false); }}>Yearly <span>Save 20%</span></button></div>
    <div className="billing-cards">
      <article className="billing-card"><p className="product-kicker">Get started</p><h2>Free</h2><p className="billing-price">₹0 <span>/month</span></p><p>Find opportunities and prepare your application.</p><ul><li>Job search and employer application links</li><li>Resume Match</li><li>10 Free resume &amp; cover letter designs</li><li>Edit and export your Free designs</li><li>Browse recruiter names and companies</li><li>Optional matching job emails</li></ul><Link href="/jobs" className="product-button">Continue with Free →</Link></article>
      <article className="billing-card billing-card-pro"><div className="billing-card-title"><div><p className="product-kicker">For your next step</p><h2>Pro</h2></div><span className="billing-label">{plan === "yearly" ? "20% yearly saving" : "One-time payment · no auto-renewal"}</span></div><p className="billing-price">{price.label}<span>{price.suffix}</span></p><p>{plan === "yearly" ? "₹279.20/month equivalent. Pay ₹3,350.40 once for 1 year; save ₹837.60 versus 12 monthly purchases. No automatic renewal." : "Pay ₹349 once for 1 month of Pro access. No automatic renewal."}</p><ul>{benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
        {status?.pro ? <Link href="/resume-builder" className="product-button product-button-primary">Your Pro tools are ready →</Link> : !signedIn ? <Link href="/login?next=%2Fplans" className="product-button product-button-primary">Sign in to get Pro →</Link> : <button ref={continueButton} type="button" className="product-button product-button-primary" disabled={busy || loading || !status || !available} onClick={() => { setCheckoutError(""); setDetailsOpen(true); }}>{loading ? "Checking your plan…" : available ? "Continue with Pro →" : "Payments are being enabled"}</button>}
        <p className="billing-small">Secure checkout by PayU. Your card or UPI details are entered with the payment provider.</p>{!available && <p className="billing-small">Checkout will open here once merchant setup and payment testing are complete.</p>}
      </article>
    </div>
    {detailsOpen && <dialog ref={checkoutDialog} className="pro-dialog" aria-labelledby="payu-checkout-title" onCancel={event => { if (busy) event.preventDefault(); else setDetailsOpen(false); }} onClose={() => setDetailsOpen(false)}>
      <div className="pro-dialog-content"><header><h2 id="payu-checkout-title" className="payu-checkout-heading">Complete your upgrade</h2><button className="pro-dialog-close" type="button" disabled={busy} aria-label="Close checkout details" onClick={() => setDetailsOpen(false)}>×</button></header>
      <form className="payu-checkout-form" onSubmit={event => { event.preventDefault(); void checkout(); }}>
        <div className="payu-checkout-summary"><span>JobTrackOS Pro · {price.name}</span><strong>{price.label}</strong><p>{plan === "yearly" ? "1 year" : "1 month"} of access · one-time payment · no automatic renewal</p></div>
        <label className="product-field">Your full name<input name="firstname" autoComplete="name" required disabled={busy} value={firstname} onChange={event => setFirstname(event.target.value)} maxLength={70} placeholder="Your name" /></label>
        <label className="product-field">Mobile number<input name="phone" type="tel" inputMode="tel" autoComplete="tel" required disabled={busy} value={phone} onChange={event => setPhone(event.target.value)} maxLength={24} placeholder="9876543210 or +91 9876543210" /><small>Indian number: 10 digits, or start with 0 / +91.</small></label>
        <label className="billing-consent"><input name="purchaseConsent" type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy}/><span>I agree to a one-time payment of {price.label} for {plan === "yearly" ? "1 year" : "1 month"} of Pro access, with no automatic renewal, and the <Link href="/terms">Terms of Service</Link>.</span></label>
        {checkoutError && <p className="payu-checkout-error" role="alert">{checkoutError}</p>}
        <button className="product-button product-button-primary" type="submit" disabled={busy || loading || !status || !available}>{busy ? "Opening secure payment…" : "Continue to PayU · " + price.label}</button>
        <button className="product-button" type="button" disabled={busy} onClick={() => setDetailsOpen(false)}>Back to plans</button>
        <p className="billing-small">Your card or UPI details are entered on PayU. Payment is not collected on this details screen.</p>
      </form></div>
    </dialog>}
    {message && <div className="billing-message" role="status">{message}</div>}
    {signedIn && <section className="billing-account product-panel" aria-labelledby="billing-account-heading"><div className="billing-account-title"><div><p className="product-kicker">Your account</p><h2 id="billing-account-heading">Pro access &amp; payments</h2></div><button type="button" className="product-button" disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Checking…" : "Refresh status"}</button></div><p>{!status ? loading ? "Checking your subscription…" : "Subscription status is unavailable. Please refresh." : status.pro ? "Pro access is active." : "Your account is on Free."}{status?.paidUntil ? ` Confirmed paid access through ${date(status.paidUntil)}.` : ""}</p>
      {subscription && <p className="billing-small">{BILLING_PLANS[subscription.plan_key].name} · {subscription.status.replaceAll("_", " ")}{subscription.cancel_scheduled ? " · Future renewals cancelled" : ""}</p>}
      {subscription && ["creating", "review"].includes(subscription.status) && <p className="billing-small">An earlier checkout needs confirmation. Contact support before starting another payment.</p>}
      {renewable && !confirmCancel && <button type="button" className="product-button" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel future renewals</button>}
      {confirmCancel && <div className="billing-message"><p>Stop future renewals? Your confirmed paid access continues until its expiry date.</p><div className="product-actions"><button type="button" className="product-button" disabled={busy} onClick={() => void cancel()}>Confirm cancellation</button><button type="button" className="product-button" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep subscription</button></div></div>}
      {!!status?.payments.length && <div className="billing-receipts">{status.payments.map(payment => <article key={payment.payment_id}><div><strong>{formatInr(payment.amount)}</strong><span>{date(payment.paid_at)} · {payment.refunded ? payment.refunded >= payment.amount ? "Refunded" : "Partially refunded" : "Payment confirmed"}</span><small>Reference: {payment.payment_id}</small></div><span className="billing-small">{payment.email_status === "sent" ? "Confirmation email sent" : "Receipt saved in your account"}</span></article>)}</div>}
    </section>}
    <div className="billing-bottom"><section className="product-panel"><p className="product-kicker">In your inbox</p><h2>Keep the important details.</h2><p>Your confirmation email includes the amount paid, payment reference, access expiry and a link to manage your subscription.</p><p>New purchases are one-time payments. There is no automatic renewal. Matching job emails follow the role, city and frequency you choose in Job Alerts.</p></section><section className="product-panel"><h2>Before you subscribe</h2><details><summary>Can I cancel?</summary><p>New PayU purchases do not renew automatically. Access ends at the confirmed expiry date. If you have an earlier Razorpay subscription, its cancellation controls remain available in your account.</p></details><details><summary>Does yearly billing charge monthly?</summary><p>No. ₹3,350.40 is a one-time purchase for 1 year. ₹279.20 is the monthly equivalent for comparison.</p></details><details><summary>Will it send emails to recruiters automatically?</summary><p>You review the draft and send it yourself through your email app.</p></details><details><summary>Need payment or refund help?</summary><p>Email <a href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a> with your payment reference. Requests are reviewed individually.</p></details></section></div>
  </div>;
}

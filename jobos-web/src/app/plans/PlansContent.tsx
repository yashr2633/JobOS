"use client";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import { BILLING_PLANS, BILLING_SUPPORT_EMAIL, formatInr, type BillingPlan } from "@/lib/billing/plans";

type BillingStatus = {
  available: boolean; pro: boolean; paidUntil: string | null;
  subscription: { id: string; plan_key: BillingPlan; status: string; cancel_scheduled: boolean } | null;
  payments: { payment_id: string; amount: number; paid_at: string; valid_until: string; email_status: string; refunded?: number }[];
};
type CheckoutResult = { razorpay_payment_id: string; razorpay_signature: string };
type RazorpayOptions = {
  key: string; subscription_id: string; name: string; description: string; image: string;
  prefill: { email?: string }; theme: { color: string };
  handler: (response: CheckoutResult) => void; modal: { ondismiss: () => void };
};
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => { open: () => void; on: (name: string, callback: () => void) => void }; } }
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/billing/${path}`, { cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({ error: "The server could not respond. Please retry shortly." }));
  if (!response.ok) throw new Error(result.error || "This request could not finish.");
  return result;
}
const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const benefits = ["64 Premium resume & cover letter designs", "Recruiter work emails, beyond free profile browsing", "Personal outreach drafts to review and send", "All Free features included"];

export default function PlansContent({ signedIn, initiallyAvailable }: { signedIn: boolean; initiallyAvailable: boolean }) {
  const [plan, setPlan] = useState<BillingPlan>("monthly"), [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null), [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false), [scriptReady, setScriptReady] = useState(false), [message, setMessage] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch("/api/billing/status", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Billing status unavailable.");
      setStatus(body);
    }).catch(error => { if (error.name !== "AbortError") setMessage("Your billing status could not load. Refresh before starting a payment."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [signedIn]);
  async function refresh() {
    setLoading(true);
    try {
      if (status?.subscription) await api("reconcile", { checkoutId: status.subscription.id }).catch(() => {});
      setStatus(await api("status"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Status unavailable."); }
    finally { setLoading(false); }
  }
  async function checkout() {
    if (busy || !consent || !window.Razorpay) return;
    setBusy(true); setMessage("");
    try {
      const session = await api("checkout", { plan, renewalConsent: true });
      const payment = new window.Razorpay({ key: session.keyId, subscription_id: session.subscriptionId,
        name: "JobTrackOS", description: `Pro · ${BILLING_PLANS[plan].name}`, image: "https://www.jobtrackos.online/brand-mark-email.png",
        prefill: { email: session.email }, theme: { color: "#204fc4" },
        modal: { ondismiss: () => { setBusy(false); setMessage("Checkout closed. Refresh your payment status before retrying."); void refresh(); } },
        handler: response => {
          void (async () => {
            try {
              const result = await api("verify", { checkoutId: session.checkoutId, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature });
              setMessage(result.confirmed ? result.testMode ? "Test payment confirmed. Production Pro access is unchanged." : "Payment confirmed. Your Pro features are ready. A confirmation email has been requested." : result.message);
              await refresh();
            } catch (error) { setMessage(error instanceof Error ? error.message : "Confirmation is pending. Do not pay again."); }
            finally { setBusy(false); }
          })();
        },
      });
      payment.on("payment.failed", () => { setBusy(false); setMessage("Payment did not complete. Check your billing status before retrying."); void refresh(); });
      payment.open();
    } catch (error) { setBusy(false); setMessage(error instanceof Error ? error.message : "Checkout could not open."); void refresh(); }
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
    {available && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => setMessage("Razorpay checkout could not load. Refresh this page or try another browser.")} />}
    <section className="billing-intro"><p className="product-kicker">JobTrackOS Pro</p><h1>Prepare better.<br/>Reach the right people.</h1><p>Start free, then upgrade for Premium designs and recruiter contact access.</p></section>
    <div className="billing-period" role="group" aria-label="Billing period"><button type="button" aria-pressed={plan === "monthly"} onClick={() => { setPlan("monthly"); setConsent(false); }}>Monthly</button><button type="button" aria-pressed={plan === "yearly"} onClick={() => { setPlan("yearly"); setConsent(false); }}>Yearly <span>Save 20%</span></button></div>
    <div className="billing-cards">
      <article className="billing-card"><p className="product-kicker">Get started</p><h2>Free</h2><p className="billing-price">₹0 <span>/month</span></p><p>Find opportunities and prepare your application.</p><ul><li>Job search and employer application links</li><li>Resume Match</li><li>10 Free resume &amp; cover letter designs</li><li>Edit and export your Free designs</li><li>Browse recruiter names and companies</li><li>Optional matching job emails</li></ul><Link href="/jobs" className="product-button">Continue with Free →</Link></article>
      <article className="billing-card billing-card-pro"><div className="billing-card-title"><div><p className="product-kicker">For your next step</p><h2>Pro</h2></div><span className="billing-label">{plan === "yearly" ? "20% yearly saving" : "Flexible monthly billing"}</span></div><p className="billing-price">{price.label}<span>{price.suffix}</span></p><p>{plan === "yearly" ? "₹279.20/month equivalent. Billed ₹3,350.40 yearly; save ₹837.60 versus monthly billing." : "Billed ₹349 each month. Stop future renewals from your account."}</p><ul>{benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
        {status?.pro ? <Link href="/resume-builder" className="product-button product-button-primary">Your Pro tools are ready →</Link> : !signedIn ? <Link href="/login?next=%2Fplans" className="product-button product-button-primary">Sign in to get Pro →</Link> : <><label className="billing-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy}/><span>I agree to recurring billing of {price.label} every {plan === "yearly" ? "year" : "month"} until I cancel, and the <Link href="/terms">Terms of Service</Link>.</span></label><button className="product-button product-button-primary" type="button" disabled={busy || loading || !status || !available || !scriptReady || !consent} onClick={() => void checkout()}>{busy ? "Checking payment…" : loading ? "Checking your plan…" : available ? `Continue to Razorpay · ${price.label}` : "Payments are being enabled"}</button></>}
        <p className="billing-small">Secure checkout by Razorpay. Your card or UPI details are entered with the payment provider.</p>{!available && <p className="billing-small">Checkout will open here once merchant setup and payment testing are complete.</p>}
      </article>
    </div>
    {message && <div className="billing-message" role="status">{message}</div>}
    {signedIn && <section className="billing-account product-panel" aria-labelledby="billing-account-heading"><div className="billing-account-title"><div><p className="product-kicker">Your account</p><h2 id="billing-account-heading">Subscription &amp; payments</h2></div><button type="button" className="product-button" disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Checking…" : "Refresh status"}</button></div><p>{!status ? loading ? "Checking your subscription…" : "Subscription status is unavailable. Please refresh." : status.pro ? "Pro access is active." : "Your account is on Free."}{status?.paidUntil ? ` Confirmed paid access through ${date(status.paidUntil)}.` : ""}</p>
      {subscription && <p className="billing-small">{BILLING_PLANS[subscription.plan_key].name} · {subscription.status.replaceAll("_", " ")}{subscription.cancel_scheduled ? " · Future renewals cancelled" : ""}</p>}
      {subscription && ["creating", "review"].includes(subscription.status) && <p className="billing-small">An earlier checkout needs confirmation. Contact support before starting another payment.</p>}
      {renewable && !confirmCancel && <button type="button" className="product-button" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel future renewals</button>}
      {confirmCancel && <div className="billing-message"><p>Stop future renewals? Your confirmed paid access continues until its expiry date.</p><div className="product-actions"><button type="button" className="product-button" disabled={busy} onClick={() => void cancel()}>Confirm cancellation</button><button type="button" className="product-button" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep subscription</button></div></div>}
      {!!status?.payments.length && <div className="billing-receipts">{status.payments.map(payment => <article key={payment.payment_id}><div><strong>{formatInr(payment.amount)}</strong><span>{date(payment.paid_at)} · {payment.refunded ? payment.refunded >= payment.amount ? "Refunded" : "Partially refunded" : "Payment confirmed"}</span><small>Reference: {payment.payment_id}</small></div><span className="billing-small">{payment.email_status === "sent" ? "Confirmation email sent" : "Receipt saved in your account"}</span></article>)}</div>}
    </section>}
    <div className="billing-bottom"><section className="product-panel"><p className="product-kicker">In your inbox</p><h2>Keep the important details.</h2><p>Your confirmation email includes the amount paid, payment reference, access expiry and a link to manage your subscription.</p><p>Razorpay also sends billing notifications. Matching job emails follow the role, city and frequency you choose in Job Alerts.</p></section><section className="product-panel"><h2>Before you subscribe</h2><details><summary>Can I cancel?</summary><p>Yes. Cancel future renewals here. Confirmed paid access stays available through its expiry date.</p></details><details><summary>Does yearly billing charge monthly?</summary><p>No. ₹3,350.40 is charged once per year. ₹279.20 is the monthly equivalent for comparison.</p></details><details><summary>Will it send emails to recruiters automatically?</summary><p>You review the draft and send it yourself through your email app.</p></details><details><summary>Need payment or refund help?</summary><p>Email <a href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a> with your payment reference. Requests are reviewed individually.</p></details></section></div>
  </div>;
}

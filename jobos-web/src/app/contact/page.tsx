import Link from "next/link";
import PublicInfoPage from "../components/PublicInfoPage";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing/plans";
export const metadata = publicPageMetadata("/contact", "Contact JobTrackOS", "Contact JobTrackOS for account, subscription, payment and product support.");
export default function ContactPage() {
  return <PublicInfoPage><p className="seo-kicker">JOBTRACKOS SUPPORT</p><h1>How can we help?</h1><p className="seo-lead">Contact us for help with your account, resume tools, recruiter directory or subscription.</p><section className="seo-card"><h2>Email support</h2><p><a className="seo-link" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a></p><p>For a payment query, include your payment reference and the email used for your JobTrackOS account. Do not send passwords, API secrets or full card details.</p></section><section className="seo-card"><h2>Manage your subscription</h2><p>View your payment history and cancel future renewals from <Link className="seo-link" href="/plans">Plans &amp; Billing</Link>. Read our <Link className="seo-link" href="/refund-policy">Cancellation &amp; Refund Policy</Link> for payment support.</p></section><section className="seo-card"><h2>Recruiter directory corrections</h2><p>Contact us to request a correction or removal of a recruiter profile. Include the name and company shown in the directory so we can identify the listing.</p></section></PublicInfoPage>;
}

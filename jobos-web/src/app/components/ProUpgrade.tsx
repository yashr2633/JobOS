"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import ProductIcon from "./ProductIcon";

const proBenefits = [
  ["60+ Premium designs", "Resume and cover letter templates to make your own."],
  ["Make each design yours", "Customise your document layout, typography and page settings."],
  ["3,000+ HR & recruiter contacts", "Unlock work emails, find the right company and approach recruiters directly."],
  ["Personal cold-email drafts", "Introduce your skills, review your message and send it from your own inbox."],
  ["Apply with better preparation", "Check Resume Match, then tailor your resume and cover letter to the job description."],
];

function ProToolkitVisual() {
  return <div className="pro-toolkit-visual" aria-hidden="true">
    <div className="pro-paper pro-paper-letter"><span>COVER LETTER</span><strong>Dear Hiring Team,</strong><i /><i /><i /><i /><small>Your story. The right introduction.</small></div>
    <div className="pro-paper pro-paper-resume"><span>YOUR NEXT CHAPTER</span><strong>Your Name</strong><small>Experience · Skills · Impact</small><b>EXPERIENCE</b><i /><i /><i /><b>SKILLS</b><i /><i /></div>
    <div className="pro-toolkit-badge">Prepare. Tailor. Reach out.<span>60+ designs · 3,000+ recruiter contacts</span></div>
  </div>;
}

export function ProUpgradeButton({ label = "Explore Pro", reason = "Prepare your next application with more tools.", className = "product-button product-button-primary" }: { label?: string; reason?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId(), reasonId = useId();
  useEffect(() => {
    if (!open || !dialog.current) return;
    const modal = dialog.current;
    const returnFocus = trigger.current;
    const previousOverflow = document.body.style.overflow;
    modal.showModal();
    document.body.style.overflow = "hidden";
    return () => { modal.close(); document.body.style.overflow = previousOverflow; returnFocus?.focus(); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
    {open && <dialog ref={dialog} className="pro-dialog" aria-labelledby={titleId} aria-describedby={reasonId} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="pro-dialog-content">
        <header><span className="pro-dialog-brand"><Image src="/brand-mark.svg" width={30} height={30} alt="" />JobTrackOS <b>Pro</b></span><button type="button" className="pro-dialog-close" aria-label="Close Pro upgrade" onClick={() => setOpen(false)}>×</button></header>
        <div className="pro-dialog-hero"><div><p className="product-kicker">Your next move, upgraded</p><h2 id={titleId}>Improve your chances<br />of being shortlisted.</h2><p id={reasonId}>{reason}</p></div><div className="pro-dialog-art"><ProToolkitVisual /></div></div>
        <div className="pro-dialog-body"><ul>{proBenefits.map(([title, detail]) => <li key={title}><ProductIcon name="check" /><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ul>
          <div className="pro-dialog-price"><div><strong>₹349<span>/month</span></strong><p>Yearly plan available with 20% savings.</p></div><span className="product-badge">All Free tools included</span></div>
          <Link className="product-button product-button-primary pro-dialog-continue" href="/plans">See plans &amp; upgrade <ProductIcon name="arrow" /></Link><div className="pro-dialog-bottom"><button type="button" onClick={() => setOpen(false)}>Not now</button><span>Secure checkout with Razorpay</span></div>
        </div><footer><Link href="/terms">Terms</Link><Link href="/privacy-policy">Privacy</Link><Link href="/refund-policy">Refund policy</Link><Link href="/contact">Contact</Link></footer>
      </div>
    </dialog>}
  </>;
}

export function ProUpgradeCard() {
  const [pro, setPro] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/plans/access", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(value => { if (value?.pro === true) setPro(true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  if (pro) return null;
  return <section className="dashboard-pro-card" aria-labelledby="dashboard-pro-title"><div className="dashboard-pro-copy"><p className="product-kicker">JobTrackOS <span className="pro-tag">Pro</span></p><h2 id="dashboard-pro-title">Improve your chances of being shortlisted.</h2><p>Prepare for the role. Reach the right people.</p><ul className="dashboard-pro-benefits"><li><strong>JD-based tailoring</strong><span>Adapt your resume and cover letter to the role.</span></li><li><strong>3,000+ HR &amp; recruiter contacts</strong><span>Unlock work emails and draft a personal introduction.</span></li><li><strong>60+ Premium designs</strong><span>Customise ATS-friendly resume and cover letter templates.</span></li></ul><div className="dashboard-pro-actions"><ProUpgradeButton label="Explore Pro →" /><span>From ₹349/month · yearly savings available</span></div></div><div className="dashboard-pro-art" aria-hidden="true"><ProToolkitVisual /></div></section>;
}

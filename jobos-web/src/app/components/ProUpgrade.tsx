"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import ProductIcon from "./ProductIcon";

const proBenefits = [
  ["60+ Premium designs", "Resume and cover letter templates to make your own."],
  ["Recruiter work emails", "Unlock contact details alongside recruiter profiles."],
  ["Personal outreach drafts", "Review your introduction and send it yourself."],
  ["Your application toolkit", "Resume Match and JD-based resume & cover letter tools included."],
];

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
        <div className="pro-dialog-hero"><div><p className="product-kicker">Your next move, upgraded</p><h2 id={titleId}>Put your best<br />application forward.</h2><p id={reasonId}>{reason}</p></div><div className="pro-dialog-art"><Image src="/career-tools/resume-templates.webp" width={560} height={700} alt="Examples of resume designs" sizes="220px" /></div></div>
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
  return <section className="dashboard-pro-card" aria-labelledby="dashboard-pro-title"><div className="dashboard-pro-copy"><p className="product-kicker">JobTrackOS <span className="pro-tag">Pro</span></p><h2 id="dashboard-pro-title">Make your next application count.</h2><p>60+ Premium designs. Recruiter emails. Personal outreach drafts.<br />Your resume and cover letter tools, together in one workspace.</p><div className="dashboard-pro-actions"><ProUpgradeButton label="Explore Pro →" /><span>From ₹349/month · yearly savings available</span></div></div><div className="dashboard-pro-art" aria-hidden="true"><Image src="/career-tools/resume-templates.webp" width={560} height={700} alt="" sizes="(max-width: 767px) 320px, 300px" /></div></section>;
}

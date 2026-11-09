"use client";
import { analyticsPath, eventProperties, type ClientEvent } from "./productModel";
let fallbackSession: string | undefined;
type Attribution = { source: string; medium?: string; campaign?: string; content?: string };
export function attribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("utm_source");
  let referrer = "direct";
  try { const host = document.referrer ? new URL(document.referrer).hostname : ""; if (host && host !== location.hostname) referrer = /google\./.test(host) ? "google" : /linkedin\./.test(host) ? "linkedin" : /instagram\./.test(host) ? "instagram" : "referral"; } catch {}
  const fresh = eventProperties({ source: source || referrer, medium: params.get("utm_medium") ?? undefined, campaign: params.get("utm_campaign") ?? undefined, content: params.get("utm_content") ?? undefined });
  try {
    const old = JSON.parse(sessionStorage.getItem("jobos_analytics_attribution") ?? "null");
    if (old && typeof old.expires === "number" && old.expires > Date.now()) return eventProperties(old.value) as Attribution;
    sessionStorage.setItem("jobos_analytics_attribution", JSON.stringify({ value: fresh, expires: Date.now() + 30 * 60_000 }));
  } catch {}
  return fresh as Attribution;
}
export function productEvent(event: ClientEvent, properties: Record<string, unknown> = {}) {
  try {
    // Respect browser privacy signals; essential server transaction records remain separate.
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
    const path = analyticsPath(location.pathname); if (!path) return;
    let session = fallbackSession ??= crypto.randomUUID();
    try {
      const old = JSON.parse(sessionStorage.getItem("jobos_analytics_session") ?? "null");
      if (old && typeof old.id === "string" && old.expires > Date.now()) session = old.id;
      else session = crypto.randomUUID();
      sessionStorage.setItem("jobos_analytics_session", JSON.stringify({ id: session, expires: Date.now() + 30 * 60_000 }));
    } catch {}
    void fetch("/api/analytics/product", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), event, session, properties: { ...attribution(), ...eventProperties(properties), path } }) }).catch(() => {});
  } catch { /* Analytics must never prevent navigation or document export. */ }
}

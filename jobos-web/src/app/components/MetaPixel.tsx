"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  MARKETING_CONSENT_EVENT, MARKETING_CONSENT_KEY, marketingConsent, privacySignal,
  permittedPixelPage, setMarketingConsent, syncMetaPixel, hasMetaSignupIntent, consumeMetaSignupIntent,
} from "@/lib/analytics/metaPixel";

export default function MetaPixel() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [choice, setChoice] = useState<"granted" | "denied" | null>(null);
  const [visible, setVisible] = useState(false);
  const [preferences, setPreferences] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const blocked = privacySignal();
      setChoice(marketingConsent());
      setVisible(!blocked && permittedPixelPage(new URL(location.href)));
      syncMetaPixel();
    };
    refresh();
    const storage = (event: StorageEvent) => { if (!event.key || event.key === MARKETING_CONSENT_KEY) refresh(); };
    window.addEventListener(MARKETING_CONSENT_EVENT, refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(MARKETING_CONSENT_EVENT, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [pathname, search]);

  useEffect(() => {
    if (!hasMetaSignupIntent()) return;
    let active = true;
    const client = createClient();
    void client.auth.getUser().then(({ data }) => {
      if (active && data.user) consumeMetaSignupIntent(data.user.created_at, data.user.id);
    }).catch(() => {});
    return () => { active = false; };
  }, [pathname]);

  if (!visible) return null;
  if (choice && !preferences) return <button type="button" onClick={() => setPreferences(true)}
    className="fixed bottom-3 left-3 z-50 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text shadow-sm">Cookie preferences</button>;
  const choose = (value: "granted" | "denied") => { setMarketingConsent(value); setPreferences(false); };
  return <aside aria-label="Marketing cookie preferences" className="fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-xl rounded-lg border border-border bg-surface p-4 text-text shadow-lg">
    <p className="text-sm leading-6">Allow Meta marketing cookies to measure visits, job views and successful signups? You can change this choice here. <Link href="/privacy-policy" className="underline">Privacy policy</Link></p>
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" onClick={() => choose("denied")} className="rounded-md border border-border px-4 py-2 text-sm">Reject marketing cookies</button>
      <button type="button" onClick={() => choose("granted")} className="rounded-md border border-border px-4 py-2 text-sm">Allow marketing cookies</button>
    </div>
  </aside>;
}

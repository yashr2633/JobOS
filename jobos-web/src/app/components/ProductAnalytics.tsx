"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { productEvent } from "@/lib/analytics/productClient";

/** No third-party script, cross-site ID, text capture or document contents. */
export default function ProductAnalytics() {
  const path = usePathname(); const seen = useRef("");
  useEffect(() => {
    if (!path || /^\/(admin|auth|api)(\/|$)/.test(path) || seen.current === path) return;
    seen.current = path; productEvent("page_view");
    if (/^\/(opportunities|jobs\/alert)\//.test(path)) productEvent("job_view");
    if (path === "/recruiters") productEvent("recruiter_view");
  }, [path]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (!target) return;
      try {
        const url = new URL(target.href, location.origin);
        if (url.origin === location.origin) {
          if (url.pathname === "/plans") productEvent("pro_view");
        } else if (target.hasAttribute("data-employer-application") || /^(jobs\.|job-boards\.|boards\.|apply\.)/.test(url.hostname) || /himalayas\.app$/.test(url.hostname)) productEvent("employer_open");
      } catch {}
    };
    document.addEventListener("click", click, true); return () => document.removeEventListener("click", click, true);
  }, []);
  return null;
}

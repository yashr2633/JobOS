"use client";

export const META_PIXEL_ID = "2602019543609898";
export const MARKETING_CONSENT_KEY = "jobtrackos_marketing_consent_v1";
export const MARKETING_CONSENT_EVENT = "jobtrackos:marketing-consent";
const REGISTRATION_KEY = "jobtrackos_meta_registration_v1";
const OAUTH_KEY = "jobtrackos_meta_signup_intent_v1";
type Pixel = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push?: Pixel;
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window { fbq?: Pixel; _fbq?: Pixel }
}
let initialized = false;
let lastPage = "";
let currentJob = "";
let jobPage = "";
const viewedJobs = new Set<string>();

export function marketingConsent(): "granted" | "denied" | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(MARKETING_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch { return null; }
}

export function privacySignal(): boolean {
  return typeof navigator !== "undefined" && (navigator.doNotTrack === "1"
    || !!(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
}

/** Pixel includes the document URL. Never run it on credential or private-data URLs. */
export function permittedPixelPage(url: URL): boolean {
  if (url.hash || !/^(\/|\/jobs|\/plans|\/signup|\/about|\/terms|\/privacy-policy|\/job-search|\/opportunities(?:\/[^/]+)?|\/jobs\/alert\/[^/]+|\/locations\/[^/]+|\/features\/[^/]+|\/guides(?:\/[^/]+)?)$/.test(url.pathname)) return false;
  for (const [key, value] of url.searchParams) {
    if (!/^(utm_(source|medium|campaign|content|term)|fbclid)$/.test(key)
      || value.length > 200 || !/^[a-zA-Z0-9_.~-]*$/.test(value)) return false;
  }
  return true;
}

function permitted(): boolean {
  return typeof window !== "undefined" && marketingConsent() === "granted"
    && !privacySignal() && permittedPixelPage(new URL(location.href));
}

function pixel(): Pixel | undefined {
  if (!permitted()) return;
  if (!window.fbq) {
    const queue: Pixel = Object.assign((...args: unknown[]) => {
      if (queue.callMethod) queue.callMethod(...args);
      else queue.queue.push(args);
    }, { queue: [] as unknown[][] });
    queue.push = queue;
    queue.loaded = true;
    queue.version = "2.0";
    window.fbq = queue;
    window._fbq ??= queue;
  }
  if (!initialized) {
    window.fbq("consent", "revoke");
    window.fbq("set", "autoConfig", false, META_PIXEL_ID);
    window.fbq("init", META_PIXEL_ID);
    initialized = true;
    if (!document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      // The real SDK pauses queue processing at the initial revoke. Resume
      // only after it has loaded and the current permission is checked again.
      script.onload = () => {
        try {
          window.fbq?.("consent", permitted() ? "grant" : "revoke");
        } catch { /* Vendor failures must not affect navigation. */ }
      };
      document.head.appendChild(script);
    }
  }
  window.fbq("consent", "grant");
  return window.fbq;
}

function track(event: "PageView" | "ViewContent" | "CompleteRegistration", properties = {}): boolean {
  try {
    const send = pixel();
    if (!send) return false;
    // Target this dataset explicitly, even if another pixel is added in the future.
    send("trackSingle", META_PIXEL_ID, event, properties);
    return true;
  } catch { return false; }
}

export function syncMetaPixel() {
  try { syncPermittedEvents(); } catch { /* Tracking must never interrupt the product. */ }
}

function syncPermittedEvents() {
  if (!permitted()) {
    if (initialized) window.fbq?.("consent", "revoke");
    if (marketingConsent() !== "granted" || privacySignal()) {
      // Discard events awaiting SDK download instead of sending them after
      // permission is later restored.
      if (window.fbq?.queue) {
        window.fbq.queue = window.fbq.queue.filter(command =>
          command[0] !== "trackSingle" && !(command[0] === "consent" && command[1] === "grant"));
      }
      lastPage = "";
      viewedJobs.clear();
      try { sessionStorage.removeItem(REGISTRATION_KEY); sessionStorage.removeItem(OAUTH_KEY); } catch {}
    }
    return;
  }
  const page = location.pathname;
  if (page !== lastPage && track("PageView")) {
    lastPage = page;
    viewedJobs.clear();
  }
  if (currentJob && jobPage === page && !viewedJobs.has(currentJob)
    && track("ViewContent", { content_type: "product", content_ids: [currentJob], content_category: "Job" })) {
    viewedJobs.add(currentJob);
  }
  try {
    const expires = Number(sessionStorage.getItem(REGISTRATION_KEY));
    if (expires && expires > Date.now() && track("CompleteRegistration")) sessionStorage.removeItem(REGISTRATION_KEY);
    else if (expires && expires <= Date.now()) sessionStorage.removeItem(REGISTRATION_KEY);
  } catch {}
}

export function setMarketingConsent(value: "granted" | "denied") {
  try { localStorage.setItem(MARKETING_CONSENT_KEY, value); } catch { return; }
  syncMetaPixel();
  window.dispatchEvent(new Event(MARKETING_CONSENT_EVENT));
}

export function metaJobView(id: string | null) {
  // Accept only bounded public listing identifiers, never titles, email or profile data.
  currentJob = id && /^[a-zA-Z0-9:_-]{1,150}$/.test(id) ? id : "";
  jobPage = typeof location === "undefined" ? "" : location.pathname;
  syncMetaPixel();
}

export function metaRegistrationComplete(userId: string) {
  if (marketingConsent() !== "granted" || privacySignal()) return;
  try {
    const key = "jobtrackos_meta_registered:" + userId;
    if (!userId || sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    sessionStorage.setItem(REGISTRATION_KEY, String(Date.now() + 5 * 60_000));
  } catch { return; }
  syncMetaPixel();
}

export function metaSignupIntent(start: boolean) {
  try {
    if (start && marketingConsent() === "granted" && !privacySignal()) {
      sessionStorage.setItem(OAUTH_KEY, String(Date.now()));
    } else sessionStorage.removeItem(OAUTH_KEY);
  } catch {}
}

/** A returning Google account must never be counted as a new registration. */
export function consumeMetaSignupIntent(createdAt: string, userId: string) {
  try {
    const started = Number(sessionStorage.getItem(OAUTH_KEY));
    sessionStorage.removeItem(OAUTH_KEY);
    const created = Date.parse(createdAt);
    if (started > 0 && Date.now() - started < 30 * 60_000 && created >= started && created <= Date.now()) {
      metaRegistrationComplete(userId);
    }
  } catch {}
}

export function hasMetaSignupIntent(): boolean {
  try { return !!sessionStorage.getItem(OAUTH_KEY); } catch { return false; }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./metaPixel.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function environment() {
  const stored = new Map<string, string>(), session = new Map<string, string>(), scripts: unknown[] = [];
  const storage = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  const context = vm.createContext({
    exports: {}, URL, Event,
    navigator: { doNotTrack: "0", globalPrivacyControl: false },
    location: new URL("https://www.jobtrackos.online/"),
    localStorage: storage(stored), sessionStorage: storage(session),
    document: {
      querySelector: () => scripts.length ? scripts[0] : null,
      createElement: () => ({}), head: { appendChild: (script: unknown) => scripts.push(script) },
    },
    window: { dispatchEvent: () => {} },
  });
  vm.runInContext(source, context);
  // The real runtime is executed here with isolated browser globals.
  const api = context.exports as typeof import("./metaPixel");
  const calls = () => context.window.fbq?.queue ?? [];
  const events = (name: string) => calls().filter((row: unknown[]) => row[0] === "trackSingle" && row[2] === name);
  return { api, context, scripts, events, calls, stored };
}

test("no script or events before consent, after rejection, or under privacy signals", () => {
  const e = environment();
  e.api.syncMetaPixel();
  e.api.metaJobView("greenhouse:example:123");
  e.api.metaRegistrationComplete("test-user");
  e.api.setMarketingConsent("denied");
  assert.equal(e.scripts.length, 0);
  e.context.navigator.globalPrivacyControl = true;
  e.api.setMarketingConsent("granted");
  assert.equal(e.scripts.length, 0);
  assert.equal(e.calls().length, 0);
});

test("initializes exactly this Pixel once and deduplicates mount/consent refresh", () => {
  const e = environment();
  e.api.setMarketingConsent("granted");
  e.api.syncMetaPixel();
  e.api.setMarketingConsent("granted");
  assert.equal(e.scripts.length, 1);
  assert.equal(e.events("PageView").length, 1);
  assert.deepEqual(Array.from(e.calls().find((row: unknown[]) => row[0] === "init")), ["init", "2602019543609898"]);
  e.context.location = new URL("https://www.jobtrackos.online/plans");
  e.api.syncMetaPixel();
  e.context.location = new URL("https://www.jobtrackos.online/");
  e.api.syncMetaPixel();
  assert.equal(e.events("PageView").length, 3);
  e.api.setMarketingConsent("denied");
  e.api.metaJobView("greenhouse:example:999");
  e.context.location = new URL("https://www.jobtrackos.online/jobs");
  e.api.syncMetaPixel();
  assert.equal(e.events("PageView").length, 0, "Withdrawal discards unsent events");
  assert.equal(e.events("ViewContent").length, 0);
});

test("blocks auth tokens, personal search data, fragments and private routes", () => {
  const e = environment();
  for (const path of ["/?code=secret", "/?email=someone@example.test", "/jobs?q=someone%40example.test", "/jobs?q=9876543210", "/jobs?q=%2B91%2098765%2043210", "/jobs?location=someone%40example.test", "/jobs?resume=private-resume-id", "/jobs?token=secret", "/jobs?mode=secret", "/jobs?q=" + "a".repeat(121), "/jobs?q=Developer&unknown=secret", "/jobs?jobSource=https%3A%2F%2Fjobs.lever.co%2Facme%2Fjob%3Ftoken%3Dsecret", "/jobs?jobSource=https%3A%2F%2Fuser%3Apassword%40jobs.lever.co%2Facme", "/jobs?jobSource=https%3A%2F%2Fevil.example%2Facme", "/jobs?fbp_debug=person%40example.test", "/#access_token=secret", "/profile", "/resumes", "/settings/account", "/api/jobs", "/auth/callback"]) {
    assert.equal(e.api.permittedPixelPage(new URL("https://www.jobtrackos.online" + path)), false, path);
  }
  e.context.location = new URL("https://www.jobtrackos.online/?code=secret");
  e.api.setMarketingConsent("granted");
  assert.equal(e.scripts.length, 0);
  assert.equal(e.api.permittedPixelPage(new URL("https://www.jobtrackos.online/?utm_source=linkedin")), true);
});

test("permits Meta test parameters and the site's public job-search URLs", () => {
  const e = environment();
  for (const path of [
    "/?fbp_debug=1234567890123456&test_event_code=TEST12345",
    "/jobs?q=Data+Analyst&location=Bangalore&experience=entry&mode=Hybrid&days=30&assistant=1",
    "/job-search?q=C%2B%2B+Developer&company=Acme&qualification=BTech",
    "/opportunities?q=Customer+Support&location=Delhi+NCR&employment=Full+Time&salary=300000&experience=1",
    "/locations/kolkata?q=Sales&days=7",
    "/jobs?job=smartrecruiters%3AAcme%3A744000160114649&jobSource=https%3A%2F%2Fjobs.smartrecruiters.com%2FAcme%2F744000160114649&fbp_debug=1",
    "/jobs/alert/greenhouse%3Aacme%3A123?fbp_debug=1&utm_source=facebook",
  ]) assert.equal(e.api.permittedPixelPage(new URL("https://www.jobtrackos.online" + path)), true, path);
  assert.equal(e.api.permittedPixelPage(new URL("https://www.jobtrackos.online/signup?q=anything")), false);
});

test("public search and Meta test URLs still require consent and deduplicate events", () => {
  const e = environment();
  e.context.location = new URL("https://www.jobtrackos.online/jobs?q=Data+Analyst&location=Delhi+NCR&fbp_debug=1");
  e.api.syncMetaPixel();
  e.api.metaJobView("greenhouse:example:123");
  assert.equal(e.scripts.length, 0);
  e.api.setMarketingConsent("granted");
  e.api.syncMetaPixel();
  e.api.metaJobView("greenhouse:example:123");
  assert.equal(e.events("PageView").length, 1);
  assert.equal(e.events("ViewContent").length, 1);
  e.context.navigator.doNotTrack = "1";
  e.api.syncMetaPixel();
  assert.equal(e.events("PageView").length, 0);
  assert.equal(e.events("ViewContent").length, 0);
  const gpc = environment();
  gpc.context.location = e.context.location;
  gpc.context.navigator.globalPrivacyControl = true;
  gpc.api.setMarketingConsent("granted");
  assert.equal(gpc.scripts.length, 0);
});

test("job details emit once per listing and page, including Strict Mode cleanup", () => {
  const e = environment();
  e.context.location = new URL("https://www.jobtrackos.online/jobs");
  e.api.setMarketingConsent("granted");
  e.api.metaJobView("greenhouse:example:123");
  e.api.metaJobView(null);
  e.api.metaJobView("greenhouse:example:123");
  assert.equal(e.events("ViewContent").length, 1);
  e.api.metaJobView("greenhouse:example:456");
  assert.equal(e.events("ViewContent").length, 2);
  e.api.metaJobView("person@example.test");
  assert.equal(e.events("ViewContent").length, 2);
});

test("successful signup emits once, and existing OAuth accounts never convert", () => {
  const e = environment();
  e.api.setMarketingConsent("granted");
  e.api.metaRegistrationComplete("synthetic-user");
  e.api.metaRegistrationComplete("synthetic-user");
  assert.equal(e.events("CompleteRegistration").length, 1);
  e.api.metaSignupIntent(true);
  e.api.consumeMetaSignupIntent("2020-01-01T00:00:00Z", "returning-user");
  assert.equal(e.events("CompleteRegistration").length, 1);
  e.api.metaSignupIntent(true);
  e.api.consumeMetaSignupIntent(new Date().toISOString(), "new-google-user");
  assert.equal(e.events("CompleteRegistration").length, 2);
  assert.ok(!JSON.stringify(e.calls()).includes("synthetic-user"));
});

test("vendor errors and blocked storage never break signup or navigation", () => {
  const e = environment();
  e.context.window.fbq = () => { throw new Error("blocked"); };
  assert.doesNotThrow(() => e.api.setMarketingConsent("granted"));
  assert.doesNotThrow(() => e.api.metaRegistrationComplete("test-user"));
  e.context.localStorage.getItem = () => { throw new Error("storage blocked"); };
  assert.doesNotThrow(() => e.api.syncMetaPixel());
});

test("real SDK load resumes the revoked queue only while consent is still valid", () => {
  const e = environment();
  e.api.setMarketingConsent("granted");
  const script = e.scripts[0] as { onload: () => void };
  script.onload();
  assert.deepEqual(Array.from(e.calls().at(-1)), ["consent", "grant"]);
  e.api.setMarketingConsent("denied");
  script.onload();
  assert.deepEqual(Array.from(e.calls().at(-1)), ["consent", "revoke"]);
  assert.equal(e.events("PageView").length, 0, "Unsent events must be dropped after withdrawal");
  e.api.setMarketingConsent("granted");
  assert.equal(e.events("PageView").length, 1);
});

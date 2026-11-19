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
  assert.equal(e.events("PageView").length, 3);
  assert.equal(e.events("ViewContent").length, 0);
});

test("blocks auth tokens, search text, fragments and private routes", () => {
  const e = environment();
  for (const path of ["/?code=secret", "/?email=someone@example.test", "/jobs?q=private", "/#access_token=secret", "/profile", "/resumes", "/settings/account", "/api/jobs", "/auth/callback"]) {
    assert.equal(e.api.permittedPixelPage(new URL("https://www.jobtrackos.online" + path)), false, path);
  }
  e.context.location = new URL("https://www.jobtrackos.online/?code=secret");
  e.api.setMarketingConsent("granted");
  assert.equal(e.scripts.length, 0);
  assert.equal(e.api.permittedPixelPage(new URL("https://www.jobtrackos.online/?utm_source=linkedin")), true);
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

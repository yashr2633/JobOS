import test from "node:test";
import assert from "node:assert/strict";
import { readJobJson, withinJobDeadline, JobRequestTimeout } from "./response.ts";
import { quickCareerReply, validateCareerReply } from "./careerReply.ts";
import { EMPTY_INTENT } from "./careerIntent.ts";
import { readFileSync } from "node:fs";
import { validWebSearchResult } from "./webSearchContract.ts";
import { reserveCareerTurn, type CareerTurnWindow } from "./careerLimit.ts";

test("hosting plaintext, HTML, empty and malformed responses never expose JSON parser errors", async () => {
  for (const body of ["An error occurred while processing your request", "<!doctype html><h1>Server error</h1>", "", "{broken", "null", "[]"])
    await assert.rejects(() => readJobJson(new Response(body, { status: 502 }), "Search is temporarily unavailable."), { message: "Search is temporarily unavailable." });
  await assert.rejects(() => readJobJson(new Response("An error occurred", { status: 200 }), "Please retry."), { message: "Please retry." });
});
test("session/quota failures stay actionable, and error JSON cannot leak parser diagnostics", async () => {
  await assert.rejects(() => readJobJson(new Response("Auth error", { status: 401 }), "Retry"), /sign in again/);
  await assert.rejects(() => readJobJson(new Response("Too many requests", { status: 429 }), "Retry"), /wait a moment/);
  const bad = await readJobJson<{ error: string }>(Response.json({ error: "Unexpected token A, not valid JSON" }, { status: 503 }), "Please retry search.");
  assert.equal(bad.error, "Please retry search.");
  const good = await readJobJson<{ error: string }>(Response.json({ error: "Choose a role before searching." }, { status: 400 }), "Retry");
  assert.equal(good.error, "Choose a role before searching.");
});
test("valid payloads and original grounded text are preserved unchanged", async () => {
  const value = { text: "Source-cited hiring lead", sources: [{ title: "Employer", url: "https://example.com/job" }], citations: [] };
  assert.deepEqual(await readJobJson(Response.json(value), "Retry"), value);
});
test("JSON-shaped errors and broken source/citation payloads cannot crash public search rendering", () => {
  const good = { text: "A cited employer lead", searchedAt: "2026-10-27T12:00:00Z", suggestionsHtml: '<div><a href="https://www.google.com/search?q=jobs">Jobs</a></div>', sources: [{ title: "Employer", url: "https://example.com/job" }], citations: [{ start: 0, end: 20, sourceIndexes: [0] }] };
  assert.equal(validWebSearchResult(good), true);
  for (const bad of [{ message: "An error occurred" }, { ...good, sources: undefined }, { ...good, text: null }, { ...good, citations: [{ start: 0, end: 20, sourceIndexes: [99] }] }, { ...good, suggestionsHtml: '<script>bad()</script>' }]) assert.equal(validWebSearchResult(bad), false);
});
test("the whole intent operation has a deadline even when authentication/upstream never settles", async () => {
  await assert.rejects(() => withinJobDeadline(() => new Promise<never>(() => {}), 10), JobRequestTimeout);
  assert.equal(await withinJobDeadline(async () => "ready", 100), "ready");
  await assert.rejects(() => withinJobDeadline(async () => { throw new Error("fixture upstream failure"); }, 100), /fixture upstream failure/);
});
test("clarification answers need no 15-second pause but keep the four-model-turn minute limit", () => {
  const windows = new Map<string, CareerTurnWindow>();
  const first = reserveCareerTurn(windows, "candidate", 1000);
  assert.equal(first.ok, true);
  assert.equal(reserveCareerTurn(windows, "candidate", 1001).ok, false, "concurrent model work is blocked");
  if (!first.ok) throw new Error("Expected reservation");
  first.window.pending = false;
  for (let turn = 1; turn < 4; turn++) {
    const next = reserveCareerTurn(windows, "candidate", 1000 + turn * 1000);
    assert.equal(next.ok, true, "a finished reply may be answered immediately");
    if (next.ok) next.window.pending = false;
  }
  assert.equal(reserveCareerTurn(windows, "candidate", 5000).ok, false);
  assert.equal(reserveCareerTurn(windows, "candidate", 61_001).ok, true);
});
test("BBF Racer asks for clarification without inventing a role or pretending to find jobs", () => {
  const reply = quickCareerReply("BBF Racer");
  assert.equal(reply?.kind, "clarify");
  if (reply?.kind !== "clarify") throw new Error("Expected clarification");
  assert.match(reply.question, /BBF Racer/);
  assert.equal("intent" in reply, false);
  assert.ok(reply.suggestions.includes("Fresher jobs"));
  assert.equal(validateCareerReply(reply)?.kind, "clarify");
});
test("fresher follow-ups resolve selected roles quickly, without requiring or inventing a resume", () => {
  const fresher = quickCareerReply("BBA fresher");
  assert.equal(fresher?.kind, "search");
  if (fresher?.kind !== "search") throw new Error("Expected broad fresher search");
  assert.equal(fresher.intent.qualification, "BBA");
  assert.equal(fresher.intent.role, "");
  for (const suggestion of ["Sales Executive fresher jobs", "Data Analyst fresher jobs"]) {
    const reply = quickCareerReply(suggestion);
    assert.equal(reply?.kind, "search");
    if (reply?.kind === "search") { assert.equal(reply.intent.experience, "entry"); assert.ok(reply.intent.role); }
  }
  assert.equal(quickCareerReply("Sales Executive", true), null, "a follow-up must retain earlier location/experience through contextual interpretation");
  const company = quickCareerReply("AWS");
  assert.equal(company?.kind === "search" && company.intent.company, "Amazon");
  const explicit = quickCareerReply("Find Deloitte analyst jobs in Hyderabad");
  assert.equal(explicit?.kind === "search" && explicit.intent.company, "Deloitte");
  assert.equal(explicit?.kind === "search" && explicit.intent.location, "Hyderabad, Telangana");
  assert.equal(quickCareerReply("contact me at private@example.com"), null);
});
test("follow-up schema rejects unsafe links, bad filters, empty searches and invalid questions", () => {
  assert.equal(validateCareerReply({ kind: "search", intent: { ...EMPTY_INTENT, role: "Analyst", location: "Kolkata" } })?.kind, "search");
  for (const value of [
    { kind: "search", intent: EMPTY_INTENT },
    { kind: "search", intent: { ...EMPTY_INTENT, role: "Analyst", location: "London" } },
    { kind: "clarify", question: "Visit https://evil.example", suggestions: [] },
    { kind: "clarify", question: "What kind of role?", suggestions: ["https://evil.example"] },
    { kind: "clarify", question: "What kind of role?", suggestions: Array(5).fill("Analyst") },
  ]) assert.equal(validateCareerReply(value), null);
});

const luminance = (hex: string) => {
  const values = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
};
const contrast = (a: string, b: string) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
test("shared light/dark text and form boundaries have measurable accessible contrast", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  for (const block of [css.match(/:root\s*\{([^}]+)\}/)![1], css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)![1]]) {
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]));
    for (const text of ["text", "text-secondary", "text-muted"]) {
      for (const surface of ["bg", "surface", "surface-2"]) assert.ok(contrast(tokens[text], tokens[surface]) >= 4.5, `${text} on ${surface} must be readable`);
    }
    assert.ok(contrast(tokens["border-strong"], tokens.surface) >= 3, "input boundaries need non-text contrast");
    assert.ok(contrast(tokens["accent-fg"], tokens.accent) >= 4.5, "primary button label must be readable");
  }
});

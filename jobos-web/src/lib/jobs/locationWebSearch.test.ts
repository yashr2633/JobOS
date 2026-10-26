import test from "node:test";
import assert from "node:assert/strict";
import { INDIA_LOCATIONS, locationSuggestions, locationMatches, resolveLocation } from "./locations.ts";
import { acceptableSearchText, publicSearchLink, readGroundedResponse, safeSearchSuggestions, validateWebQuery } from "./webSearchContract.ts";
import { searchPublicJobs } from "./webSearch.ts";

test("real India location data spans all states/UTs and suggests Dhanbad from its first letter", () => {
  assert.ok(INDIA_LOCATIONS.length > 7000);
  assert.equal(new Set(INDIA_LOCATIONS.map(city => city.state)).size, 36);
  assert.ok(locationSuggestions("D", 12).some(city => city.label === "Dhanbad, Jharkhand"));
  assert.equal(locationSuggestions("धनबाद")[0]?.label, "Dhanbad, Jharkhand");
  assert.equal(locationSuggestions("Dhanbad Jharkhand")[0]?.label, "Dhanbad, Jharkhand");
  assert.equal(locationSuggestions("Bangalore")[0]?.city, "Bengaluru");
  assert.equal(resolveLocation("Dhanbad")?.state, "Jharkhand");
});

test("city/state selection matches actual abbreviations without excluding city-only job locations", () => {
  assert.equal(locationMatches("Dhanbad, JH, India", "Dhanbad, Jharkhand"), true);
  assert.equal(locationMatches("Dhanbad, India", "Dhanbad, Jharkhand"), true);
  assert.equal(locationMatches("Dhanbad, WB, India", "Dhanbad, Jharkhand"), false);
  assert.equal(locationMatches("Dhanbad, Jharkhand, India", "धनबाद"), true);
  assert.equal(locationMatches("Ranchi, India", "Jharkhand"), true);
  assert.equal(locationMatches("Bangalore, India", "Bengaluru, Karnataka"), true);
  assert.equal(locationMatches("Mumbai, MH, India", "Dhanbad, Jharkhand"), false);
  assert.equal(locationMatches("India", "D"), false);
});

const suggestion = '<style>.container{display:flex}</style><div class="container"><a href="https://www.google.com/search?q=jobs">Jobs</a></div>';
const grounded = () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Public hiring leads with source links. Check availability on the original site." }] }, groundingMetadata: {
  searchEntryPoint: { renderedContent: suggestion }, groundingChunks: [{ web: { title: "Original source", uri: "https://employer.example/careers" } }],
  groundingSupports: [{ segment: { startIndex: 0, endIndex: 43 }, groundingChunkIndices: [0] }],
} }] });

test("web responses require actual grounding and associated safe search suggestions", () => {
  const response = grounded(), result = readGroundedResponse(response, "2026-10-26T12:00:00Z");
  assert.equal(result?.text, response.candidates[0].content.parts[0].text);
  assert.equal(result?.suggestionsHtml, suggestion, "provider markup is not rewritten");
  assert.equal(result?.sources[0].url, "https://employer.example/careers");
  assert.deepEqual(result?.citations[0], { start: 0, end: 43, sourceIndexes: [0] });
  assert.equal(readGroundedResponse({ candidates: [{ ...response.candidates[0], groundingMetadata: {} }] }, "now"), null);
  assert.equal(readGroundedResponse({ candidates: [{ ...response.candidates[0], finishReason: "MAX_TOKENS" }] }, "now"), null);
});

test("web search rejects known expired deadlines, inflated vacancy counts and oversized lists", () => {
  assert.equal(acceptableSearchText("The last date to apply was September 25, 2026.", "2026-10-26"), false);
  assert.equal(acceptableSearchText("Apply by November 4, 2026; check the original source.", "2026-10-26"), true);
  assert.equal(acceptableSearchText("391 full-time vacancies in this city", "2026-10-26"), false);
  assert.equal(acceptableSearchText(Array.from({length:7}, (_, i) => `${i+1}. Lead`).join("\n"), "2026-10-26"), false);
  const response = grounded();
  response.candidates[0].groundingMetadata.groundingSupports = [];
  assert.equal(readGroundedResponse(response, "2026-10-26T12:00:00Z"), null);
});

test("provider HTML cannot introduce scripts, frames, event handlers, embedded resources or unsafe links", () => {
  assert.equal(safeSearchSuggestions(suggestion), true);
  for (const unsafe of [suggestion + '<script>alert(1)</script>', suggestion.replace('class="container"', 'onclick="alert(1)"'),
    '<iframe src="https://www.google.com"></iframe>', '<img src="https://example.com/pixel">', suggestion.replace('https://www.google.com/search?q=jobs', 'javascript:alert(1)'),
    suggestion.replace('https://www.google.com/search?q=jobs', 'https://evil.example'), suggestion.replace('display:flex', '@import "https://evil.example/a.css"'),
    suggestion + '<a href=&#x6a;avascript:alert(1)>unsafe</a>']) assert.equal(safeSearchSuggestions(unsafe), false);
  for (const value of ["http://example.com", "https://127.0.0.1", "https://10.0.0.1", "https://[::1]", "https://foo.local", "https://user:secret@example.com"]) assert.equal(publicSearchLink(value), null);
});

test("web queries accept real city/role input but never private contact fields or arbitrary URLs", () => {
  assert.deepEqual(validateWebQuery({ keywords: "SQL analyst", location: "Dhanbad, Jharkhand" }), { keywords: "SQL analyst", location: "Dhanbad, Jharkhand" });
  assert.ok(validateWebQuery({ keywords: "नौकरी", location: "धनबाद" }));
  for (const input of [{ keywords: "contact@example.com", location: "Dhanbad" }, { keywords: "https://example.com", location: "Dhanbad" },
    { keywords: "01234567890", location: "Dhanbad" }, { keywords: "SQL", location: "D" }, { keywords: "x".repeat(121), location: "Dhanbad" }]) assert.equal(validateWebQuery(input), null);
});

test("grounded job search sends only public terms and fails rather than fabricate offline results", async () => {
  const oldFetch = globalThis.fetch, oldKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-only";
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    assert.equal(options?.cache, "no-store");
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json(grounded());
  };
  try {
    const result = await searchPublicJobs({ keywords: "teacher", location: "Dhanbad" });
    assert.ok(result.text);
    const sent = JSON.stringify(bodies[0]);
    assert.ok(sent.includes("Dhanbad"));
    assert.ok(!sent.includes("test-only"));
    assert.ok(!sent.includes("user_id"));
    assert.ok(!sent.includes("extracted_text"));
    assert.deepEqual(bodies[0].tools, [{ google_search: {} }]);
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "Invented jobs without grounding" }] } }] });
    await assert.rejects(searchPublicJobs({ keywords: "teacher", location: "Dhanbad" }), /source-linked/);
    globalThis.fetch = async () => new Response(null, { status: 429 });
    await assert.rejects(searchPublicJobs({ keywords: "teacher", location: "Dhanbad" }), /quota/);
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(searchPublicJobs({ keywords: "teacher", location: "Dhanbad" }), /unavailable/);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey; }
});

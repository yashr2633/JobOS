import test from "node:test";
import assert from "node:assert/strict";
import { publicResearchCache } from "./publicResearchCache.ts";
import { availableAssistantCatalogs } from "./assistantCatalog.ts";
import type { WebSearchResult } from "./webSearchContract.ts";

const result = { searchedAt: "2026-10-30T00:00:00Z" } as WebSearchResult;
test("identical public research requests share one provider request and preserve its date", async () => {
  let calls = 0;
  let finish!: (value: WebSearchResult) => void;
  const read = publicResearchCache(async query => { calls++; assert.deepEqual(Object.keys(query).sort(), ["keywords", "location"]); return new Promise(resolve => { finish = resolve; }); });
  const a = read({ keywords: "Sales Executive", location: "Kolkata" });
  const b = read({ keywords: " sales   executive ", location: "kolkata" });
  finish(result);
  assert.equal(await a, result); assert.equal(await b, result);
  assert.equal((await read({ keywords: "Sales Executive", location: "Kolkata" })).searchedAt, result.searchedAt);
  assert.equal(calls, 1);
});
test("expired research is refreshed; a different city is not served the same cached answer", async () => {
  let time = 0, calls = 0;
  const read = publicResearchCache(async () => { calls++; return result; }, () => time);
  await read({ keywords: "Analyst", location: "Delhi" });
  await read({ keywords: "Analyst", location: "Mumbai" });
  time = 15 * 60_000 + 1;
  await read({ keywords: "Analyst", location: "Delhi" });
  assert.equal(calls, 3);
});
test("failed research is not cached or disguised as a successful empty response", async () => {
  let calls = 0;
  const read = publicResearchCache(async () => { if (++calls === 1) throw new Error("Provider unavailable"); return result; });
  await assert.rejects(read({ keywords: "Analyst", location: "India" }));
  assert.equal(await read({ keywords: "Analyst", location: "India" }), result);
  assert.equal(calls, 2);
});
test("a catalog with no configured sources is not evidence of zero vacancies", () => {
  assert.equal(availableAssistantCatalogs([{ status: "fulfilled", value: { jobs: [], warnings: ["No boards configured"], checkedAt: "2026-10-30", sources: [] } }]), null);
});

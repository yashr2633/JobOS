import test from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../jobs/types.ts";
import { refreshOpportunityIfStale } from "./opportunityFreshness.ts";

const now = Date.parse("2026-11-12T12:00:00Z");
const old = { source: "SmartRecruiters", board: "SGS", fetchedAt: "2026-11-12T10:00:00Z" } as Job;
test("an old cached vacancy is checked again before it can become a false 404", async () => {
  const fresh = { ...old, fetchedAt: new Date(now).toISOString() };
  assert.equal(await refreshOpportunityIfStale(old, async () => fresh, now), fresh);
  assert.equal(await refreshOpportunityIfStale(old, async () => null, now), null);
  await assert.rejects(refreshOpportunityIfStale(old, async () => { throw new Error("Source outage"); }, now), /Source outage/);
  assert.equal(await refreshOpportunityIfStale(fresh, async () => { throw new Error("Unnecessary fetch"); }, now), fresh);
});

import test from "node:test";
import assert from "node:assert/strict";
import { allowed, deadlineValue, field, isUuid, websiteValue, STAGES } from "./validation.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("employer inputs reject invalid identities, overlong text and invalid dates", () => {
  assert.equal(isUuid("a8a26a74-921d-4292-9e5f-5ea395cfc878"), true);
  assert.equal(isUuid("../other-company"), false);
  assert.equal(deadlineValue("2026-10-31"), "2026-10-31");
  assert.equal(deadlineValue(""), null);
  assert.throws(() => deadlineValue("2026-02-30"));
  assert.throws(() => deadlineValue("yesterday"));
  const data = new FormData();
  data.set("name", "  Company  ");
  assert.equal(field(data, "name", 2, 160), "Company");
  data.set("name", "x".repeat(161));
  assert.throws(() => field(data, "name", 2, 160));
  assert.throws(() => allowed("Owner", STAGES));
  assert.equal(allowed("Interview", STAGES), "Interview");
});

test("company website accepts HTTPS and rejects executable and credential URLs", () => {
  assert.equal(websiteValue(""), "");
  assert.equal(websiteValue("https://example.com/careers"), "https://example.com/careers");
  for (const value of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com"]) assert.throws(() => websiteValue(value));
});

test("new employer storage has RLS; applicant writes use guarded transaction functions", () => {
  const sql = readFileSync(resolve("supabase-schema-employer-workspace.sql"), "utf8");
  for (const table of ["employer_companies", "employer_jobs", "employer_submissions", "employer_submission_notes"]) assert.match(sql, new RegExp(`${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_employer_application[^;]+FROM PUBLIC,anon/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_employer_application_stage[^;]+FROM PUBLIC,anon/);
  assert.match(sql, /p_consent IS DISTINCT FROM true/);
  assert.match(sql, /WHERE id=p_resume AND user_id=v_user/);
  assert.match(sql, /c\.owner_id=auth\.uid\(\) FOR UPDATE OF s/);
  assert.match(sql, /UNIQUE\(job_id,candidate_id\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.doesNotMatch(sql, /GRANT[^;]*(?:INSERT|UPDATE)[^;]*ON public\.employer_submissions TO authenticated/);
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON public\.resumes/i);
});

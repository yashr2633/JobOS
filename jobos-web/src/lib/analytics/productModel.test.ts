import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsPath, analyticsPeriod, csvCell, eventProperties, parseProductEvent } from "./productModel.ts";
const id = "11111111-1111-4111-8111-111111111111";
test("client telemetry cannot assert payments or server-confirmed success", () => {
  for (const event of ["payment_captured", "document_exported", "resume_tailored", "recruiter_unlocked", "generation_failed"]) assert.equal(parseProductEvent({ id, event }), null);
  assert.ok(parseProductEvent({ id, event: "page_view", session: id }));
  assert.equal(parseProductEvent({ id: "bad", event: "page_view" }), null);
  assert.equal(parseProductEvent({ id, event: "page_view", session: "bad" }), null);
});
test("arbitrary metadata, private contents, URLs and contact details are never retained", () => {
  const value = eventProperties({ email: "private@example.test", phone: "9999999999", resume: "private", body: "private message", source: "linkedin", campaign: "jobs_20261109", properties: { secret: true }, company: "Acme", reason: "secret@example.test", location: "https://example.test/x", category: "9876543210", durationMs: Infinity });
  assert.deepEqual(value, { source: "linkedin", campaign: "jobs_20261109", company: "Acme" });
  assert.deepEqual(eventProperties(null), {});
});
test("page paths drop query tokens and dynamic identifiers; admin/auth paths are excluded", () => {
  assert.equal(analyticsPath("/jobs?token=secret"), "/jobs");
  assert.equal(analyticsPath("/opportunities/smartrecruiters%3ABoard%3A12345678"), "/opportunities/:id");
  for (const path of ["//evil.test", "/admin/analytics", "/auth/callback", "/api/private", "https://x.test"]) assert.equal(analyticsPath(path), undefined);
});
test("periods and CSV exports reject misleading filters and neutralise spreadsheet formulas", () => {
  assert.equal(analyticsPeriod(null), 28); assert.equal(analyticsPeriod("7"), 7); assert.equal(analyticsPeriod("90"), 90);
  assert.equal(analyticsPeriod("-7"), null); assert.equal(analyticsPeriod("28x"), null);
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(" =HYPERLINK(\"x\")").startsWith('"\''), true);
  assert.equal(csvCell("\t@cmd").startsWith('"\''), true);
  assert.equal(csvCell(null), '""');
});

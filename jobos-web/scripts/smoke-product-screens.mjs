import assert from "node:assert/strict";

// Local anonymous smoke test. It never signs in, submits an application or
// changes remote data. Run against `next start --port 3100` after building.
const base = new URL(process.env.PRODUCT_SMOKE_URL ?? "http://localhost:3100");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Run this smoke test against a local preview only.");
const exampleId = "11111111-1111-4111-8111-111111111111";
const privatePages = [
  "/applications", "/resumes", "/profile", "/gmail/review", "/jobs?q=Data%20Analyst",
  `/jobs/internal/${exampleId}`, `/jobs/applied/${exampleId}`,
  "/employer", "/employer/jobs", "/employer/jobs/new", "/employer/company",
  "/employer/applicants", `/employer/applicants/${exampleId}`, `/employer/jobs/${exampleId}/edit`,
];

for (const pathname of privatePages) {
  const response = await fetch(new URL(pathname, base), { redirect: "manual", signal: AbortSignal.timeout(30000) });
  assert.ok([302, 303, 307, 308].includes(response.status), `${pathname}: expected authentication redirect, received ${response.status}`);
  const target = new URL(response.headers.get("location"), base);
  assert.ok(["/login", "/employer/login"].includes(target.pathname), `${pathname}: incorrect login destination`);
  if (pathname.includes("?q=")) {
    const continuation = new URL(target.searchParams.get("next"), base);
    assert.equal(continuation.pathname, "/jobs");
    assert.equal(continuation.searchParams.get("q"), "Data Analyst", "search intent must survive sign in");
  }
  console.log(`PASS protected route ${pathname}`);
}

// Login's static HTML contains its Suspense fallback; hydrated controls are
// verified separately in the browser rather than inferred from initial HTML.
for (const [pathname, expected] of [["/", "Find the right job."], ["/login", "JobTrackOS account"], ["/employer/login", "Hire with a clearer view"], ["/signup", "Create"], ["/sitemap.xml", "https://www.jobtrackos.online"], ["/robots.txt", "sitemap.xml"]]) {
  const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `${pathname}: expected a successful public response`);
  const body = await response.text();
  assert.ok(body.includes(expected), `${pathname}: missing expected content`);
  console.log(`PASS public route ${pathname}`);
}

const unauthorized = await fetch(new URL("/api/jobs/action", base), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  signal: AbortSignal.timeout(30000),
});
assert.equal(unauthorized.status, 401, "job actions must reject anonymous requests before any mutation");
console.log("PASS job action API rejects anonymous requests");
console.log("21 local route checks passed. Authenticated/database/provider flows are separate checks.");

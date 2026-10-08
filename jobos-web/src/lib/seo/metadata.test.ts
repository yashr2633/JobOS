import test from "node:test";
import assert from "node:assert/strict";
import robots from "../../app/robots.ts";
import sitemap from "../../app/sitemap.ts";
import { hasSessionCookie, homepageMetadata, PUBLIC_STRUCTURED_DATA_JSON, publicPageMetadata, SITE_ORIGIN } from "./metadata.ts";

test("the sitemap contains only public canonical pages, never personal routes or fabricated dates", () => {
  const entries = sitemap();
  assert.deepEqual(entries.map(entry => entry.url), [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/privacy-policy`, `${SITE_ORIGIN}/terms`]);
  assert.ok(entries.every(entry => entry.lastModified === undefined));
  assert.equal(robots().sitemap, `${SITE_ORIGIN}/sitemap.xml`);
});

test("anonymous public pages are indexable with consistent canonical and sharing URLs", () => {
  for (const path of ["/", "/privacy-policy", "/terms"] as const) {
    const metadata = publicPageMetadata(path, "JobTrackOS", "Product facts");
    assert.equal(metadata.alternates?.canonical, new URL(path, SITE_ORIGIN).href);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.equal(metadata.openGraph?.url, metadata.alternates?.canonical);
  }
});

test("the homepage excludes session cookies, including chunked/expired cookie names, without affecting auth", () => {
  assert.equal(hasSessionCookie(["theme", "sb-project-auth-token-code-verifier"]), false);
  for (const names of [["sb-project-auth-token"], ["sb-project-auth-token.0", "sb-project-auth-token.1"]]) {
    const metadata = homepageMetadata(names);
    assert.ok(metadata.robots && typeof metadata.robots === "object");
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.robots.follow, false);
  }
  assert.deepEqual(homepageMetadata([]).robots, { index: true, follow: true });
});

test("structured data describes only supported public identity, with no fabricated rich result claims", () => {
  const data = JSON.parse(PUBLIC_STRUCTURED_DATA_JSON);
  assert.deepEqual(data["@graph"].map((entry: {"@type": string}) => entry["@type"]), ["Organization", "WebSite"]);
  assert.ok(!/aggregateRating|review|offers|price|userId|email|SearchAction/.test(PUBLIC_STRUCTURED_DATA_JSON));
  assert.ok(!PUBLIC_STRUCTURED_DATA_JSON.includes("<"));
});

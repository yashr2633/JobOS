import assert from "node:assert/strict";
import test from "node:test";
import { isDocumentRequestOrigin } from "./requestOrigin.ts";

test("document writes accept the browser host when Next binds to all interfaces", () => {
  assert.equal(isDocumentRequestOrigin(new Request("http://0.0.0.0:3000/api/documents", { headers: { host: "localhost:3000", origin: "http://localhost:3000" } })), true);
  assert.equal(isDocumentRequestOrigin(new Request("https://www.jobtrackos.online/api/documents", { headers: { host: "www.jobtrackos.online", origin: "https://www.jobtrackos.online" } })), true);
});
test("document writes reject foreign, null, malformed and cross-site origins", () => {
  for (const origin of ["https://evil.example", "http://www.jobtrackos.online", "null", "https://www.jobtrackos.online@evil.example", "https://www.jobtrackos.online/path"]) {
    assert.equal(isDocumentRequestOrigin(new Request("https://www.jobtrackos.online/api/documents", { headers: { host: "www.jobtrackos.online", origin } })), false);
  }
  assert.equal(isDocumentRequestOrigin(new Request("https://www.jobtrackos.online/api/documents", { headers: { "sec-fetch-site": "cross-site" } })), false);
});

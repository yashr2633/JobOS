/**
 * Gmail source-link builder tests.
 *
 * Covers the two properties the manual-verification bug turned on:
 *  - the URL pins the CONNECTED account (authuser=<address>), not u/0 default,
 *  - the URL points at the EXACT stored message id,
 * plus the non-Gmail case, where no id means no link (so the UI hides it).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildGmailMessageUrl } from "./sourceLink.ts";

test("targets the connected account via authuser and the exact message", () => {
  const url = buildGmailMessageUrl("msg-abc123", "person@example.com");

  assert.ok(url, "a message id must produce a url");
  // Account targeting: explicit authuser for the connected mailbox.
  assert.match(url!, /authuser=person%40example\.com/);
  // Exact message: the stored id is in the #all/ fragment.
  assert.match(url!, /#all\/msg-abc123$/);
  // It is a Gmail web URL, not a generic search or homepage.
  assert.ok(url!.startsWith("https://mail.google.com/mail"));
});

test("the message id is used verbatim, never guessed or dropped", () => {
  const url = buildGmailMessageUrl("199aabbccddee00", "user@company.co");
  assert.match(url!, /#all\/199aabbccddee00$/);
});

test("special characters in the address and id are encoded", () => {
  const url = buildGmailMessageUrl("id/with space", "a+b@example.com");
  assert.match(url!, /authuser=a%2Bb%40example\.com/);
  assert.match(url!, /#all\/id%2Fwith%20space$/);
});

test("without a connected address it still opens the exact message (fallback)", () => {
  const url = buildGmailMessageUrl("msg-xyz", null);
  assert.equal(url, "https://mail.google.com/mail/u/0/#all/msg-xyz");
  // No authuser is asserted here: the fallback deliberately omits it rather
  // than inventing an address.
  assert.doesNotMatch(url!, /authuser=/);
});

test("a blank or missing message id yields no link (non-Gmail applications)", () => {
  assert.equal(buildGmailMessageUrl(null), null);
  assert.equal(buildGmailMessageUrl(undefined), null);
  assert.equal(buildGmailMessageUrl(""), null);
  assert.equal(buildGmailMessageUrl("   "), null);
});

test("a blank address is treated as no address, not an empty authuser", () => {
  const url = buildGmailMessageUrl("msg-1", "   ");
  assert.equal(url, "https://mail.google.com/mail/u/0/#all/msg-1");
  assert.doesNotMatch(url!, /authuser=/);
});

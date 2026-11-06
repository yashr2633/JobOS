import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { capturedPayUPayment, payuCommandHash, payuPaise, payuRequestHash, payuResponseHash, validPayUResponse } from "./payuVerification.ts";
const sha = (text: string) => createHash("sha512").update(text).digest("hex");
const key = "unit-merchant", salt = "unit-secret";
const fields = { key, txnid: `jt${"1".repeat(32)}`, amount: "349.00", productinfo: "JobTrackOS Pro monthly", firstname: "Test Customer", email: "test@example.com", status: "success" };
test("hosted checkout uses the documented SHA512 request field order", () => {
  assert.equal(payuRequestHash(fields, salt), sha(`${key}|${fields.txnid}|349.00|JobTrackOS Pro monthly|Test Customer|test@example.com|||||||||||${salt}`));
  assert.equal(payuCommandHash(key, "verify_payment", fields.txnid, salt), sha(`${key}|verify_payment|${fields.txnid}|${salt}`));
});
test("reverse hash authenticates successful and failed callbacks, including additional charges", () => {
  for (const status of ["success", "failure"]) {
    const callback = { ...fields, status, hash: sha(`${salt}|${status}|||||||||||test@example.com|Test Customer|JobTrackOS Pro monthly|349.00|${fields.txnid}|${key}`) };
    assert.equal(validPayUResponse(callback, key, salt), true);
    assert.equal(validPayUResponse({ ...callback, amount: "1.00" }, key, salt), false);
    assert.equal(validPayUResponse({ ...callback, email: "other@example.com" }, key, salt), false);
    assert.equal(validPayUResponse(callback, key, "wrong-salt"), false);
  }
  const extra = { ...fields, additionalCharges: "2.00" };
  assert.equal(validPayUResponse({ ...extra, hash: payuResponseHash(extra, salt) }, key, salt), true);
});
test("invalid, missing, foreign and split-payment callback signatures fail closed", () => {
  for (const hash of ["", "abc", "x".repeat(128), "0".repeat(128)]) assert.equal(validPayUResponse({ ...fields, hash }, key, salt), false);
  const hash = payuResponseHash(fields, salt);
  assert.equal(validPayUResponse({ ...fields, hash }, "other-key", salt), false);
  assert.equal(validPayUResponse({ ...fields, hash, splitInfo: "unexpected" }, key, salt), false);
});
test("rupee amounts are parsed exactly; malformed, negative and fractional-paise inputs are rejected", () => {
  for (const [input, expected] of [["349", 34900], ["349.00", 34900], ["3350.40", 335040], [3350.4, 335040]] as const) assert.equal(payuPaise(input), expected);
  for (const input of [null, {}, "-349", "349.001", "1e3", "349 INR", "NaN", "Infinity"]) assert.equal(payuPaise(input), null);
});
const order = { txnid: fields.txnid, amount: 34900, productinfo: fields.productinfo, email: fields.email };
const captured = { txnid: fields.txnid, status: "success", unmappedstatus: "captured", mihpayid: "1234567890", transaction_amount: "349.00", amt: "349.00", productinfo: fields.productinfo };
test("the server accepts a captured exact-price transaction and the documented response without email", () => {
  assert.equal(capturedPayUPayment(order, captured), "1234567890");
  assert.equal(capturedPayUPayment(order, { ...captured, email: fields.email }), "1234567890");
});
test("a browser success string cannot grant access for pending, failed, foreign or wrong-price payments", () => {
  for (const change of [{ status: "failure" }, { unmappedstatus: "pending" }, { txnid: "foreign" }, { amt: "1.00" }, { transaction_amount: "3350.40" }, { productinfo: "Other product" }, { email: "foreign@example.com" }, { mihpayid: "Not Found" }]) assert.equal(capturedPayUPayment(order, { ...captured, ...change }), null);
  assert.equal(capturedPayUPayment(order, { ...captured, txnid: undefined }), null);
});

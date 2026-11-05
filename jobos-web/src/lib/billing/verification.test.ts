import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BILLING_PLANS } from "./plans.ts";
import { validSignature, verifiedPurchase, type ProviderInvoice, type ProviderPayment, type ProviderSubscription } from "./verification.ts";
const start = 1793836800, end = start + 30 * 86400;
const sub: ProviderSubscription = { id: "sub_example123", plan_id: "plan_monthly123", status: "active", current_start: start, current_end: end, notes: { app: "jobtrackos" } };
const payment: ProviderPayment = { id: "pay_example123", invoice_id: "inv_example123", amount: 34900, currency: "INR", captured: true, status: "captured", created_at: start + 20 };
const invoice: ProviderInvoice = { id: "inv_example123", subscription_id: sub.id, payment_id: payment.id, status: "paid", amount_paid: 34900, currency: "INR", billing_start: start, billing_end: end };
test("yearly price is exactly twenty percent below twelve monthly payments", () => {
  assert.equal(BILLING_PLANS.yearly.amount, BILLING_PLANS.monthly.amount * 12 * .8);
});
test("checkout and raw webhook signatures reject tampering and wrong secrets", () => {
  const secret = "test-only-signing-secret", body = `${payment.id}|${sub.id}`;
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(validSignature(body, signature, secret), true);
  for (const altered of [body + " ", `${payment.id}|sub_another123`, JSON.stringify({ body })]) assert.equal(validSignature(altered, signature, secret), false);
  assert.equal(validSignature(body, signature, "wrong"), false);
  for (const bad of [null, "", "ff", "z".repeat(64)]) assert.equal(validSignature(body, bad, secret), false);
});
test("a captured paid invoice grants exactly its billing period", () => {
  const result = verifiedPurchase("monthly", sub, payment, invoice, sub.plan_id);
  assert.equal(result?.validUntil, new Date(end * 1000).toISOString());
  assert.equal(result?.amount, 34900);
});
test("authorization, failed payments and full refunds never grant access", () => {
  for (const changed of [{ status: "authorized", captured: false }, { status: "failed" }, { amount_refunded: 34900 }, { captured: false }]) assert.equal(verifiedPurchase("monthly", sub, { ...payment, ...changed }, invoice, sub.plan_id), null);
});
test("payment from another subscription, plan, app, amount or currency is rejected", () => {
  for (const changed of [{ subscription_id: "sub_someoneElse" }, { payment_id: "pay_someoneElse" }, { id: "inv_someoneElse" }, { amount_paid: 1 }, { currency: "USD" }, { status: "issued" }]) assert.equal(verifiedPurchase("monthly", sub, payment, { ...invoice, ...changed }, sub.plan_id), null);
  for (const changed of [{ amount: 1 }, { currency: "USD" }, { invoice_id: "inv_other" }]) assert.equal(verifiedPurchase("monthly", sub, { ...payment, ...changed }, invoice, sub.plan_id), null);
  assert.equal(verifiedPurchase("monthly", sub, payment, invoice, "plan_other123"), null);
  assert.equal(verifiedPurchase("monthly", { ...sub, notes: { app: "course" } }, payment, invoice, sub.plan_id), null);
});
test("old payments cannot be attached to a newer subscription cycle", () => {
  const nextCycle = { ...sub, current_start: end, current_end: end + 30 * 86400 };
  assert.equal(verifiedPurchase("monthly", nextCycle, payment, { ...invoice, billing_start: null, billing_end: null }, sub.plan_id), null);
  assert.equal(verifiedPurchase("monthly", sub, payment, { ...invoice, billing_start: null, billing_end: null }, sub.plan_id)?.validUntil, new Date(end * 1000).toISOString());
});
test("invalid or excessive billing periods are refused", () => {
  for (const changed of [{ billing_start: 0 }, { billing_end: start }, { billing_end: start + 365 * 86400 }, { billing_end: Infinity }]) assert.equal(verifiedPurchase("monthly", sub, payment, { ...invoice, ...changed }, sub.plan_id), null);
  for (const created_at of [NaN, Infinity, -1, 0]) assert.equal(verifiedPurchase("monthly", sub, { ...payment, created_at }, invoice, sub.plan_id), null);
});

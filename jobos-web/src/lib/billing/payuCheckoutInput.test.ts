import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIndianMobile, validatePayUCheckout } from "./payuCheckoutInput.ts";
test("mobile numbers accept local, +91, 91, 0091, trunk-prefix and pasted formatting", () => {
  for (const value of ["9876543210", "+91 98765 43210", "919876543210", "00919876543210", "09876543210", "(+91) 98765-43210", "\u200b+91 9876543210\ufeff", "９８７６５４３２１０"]) assert.equal(normalizeIndianMobile(value), "9876543210", value);
});
test("wrong-country, incomplete, text and non-mobile numbers fail clearly", () => {
  for (const value of ["+1 9876543210", "98765", "1234567890", "9876543210x", null, 9876543210]) assert.equal(normalizeIndianMobile(value), null);
});
test("names accept initials, Unicode, apostrophes and ordinary formatting without weakening payment consent", () => {
  for (const firstname of ["A", "Yash Raj", "सिद्धार्थ", "O’Neil", "  Yash   Raj  "]) {
    const result = validatePayUCheckout({ plan: "monthly", firstname, phone: "919876543210", purchaseConsent: true });
    assert.equal(result.ok, true, firstname);
    if (result.ok) assert.equal(result.value.phone, "9876543210");
  }
});
test("errors identify the exact field instead of a generic blocked checkout message", () => {
  const valid = { plan: "yearly", firstname: "Test Name", phone: "9876543210", purchaseConsent: true };
  for (const [field, value] of [["plan", "invalid"], ["firstname", ""], ["phone", "91"], ["purchaseConsent", false], ["purchaseConsent", "true"], ["firstname", "Name|injected"], ["firstname", "<script>"]] as const) {
    const result = validatePayUCheckout({ ...valid, [field]: value });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.field, field); assert.ok(result.error.length > 20); }
  }
});

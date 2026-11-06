import { createHash, timingSafeEqual } from "node:crypto";

export type PayUFields = Record<string, string>;
const sha512 = (value: string) => createHash("sha512").update(value).digest("hex");
export const payuCommandHash = (key: string, command: string, reference: string, salt: string) => sha512([key, command, reference, salt].join("|"));
export function payuRequestHash(fields: PayUFields, salt: string) {
  return sha512([fields.key, fields.txnid, fields.amount, fields.productinfo, fields.firstname, fields.email,
    ...[1, 2, 3, 4, 5].map(n => fields[`udf${n}`] ?? ""), "", "", "", "", "", salt].join("|"));
}
export function payuResponseHash(fields: PayUFields, salt: string) {
  const values = [salt, fields.status, "", "", "", "", "", ...[5, 4, 3, 2, 1].map(n => fields[`udf${n}`] ?? ""),
    fields.email, fields.firstname, fields.productinfo, fields.amount, fields.txnid, fields.key];
  const charges = fields.additional_charges ?? fields.additionalCharges;
  if (charges) values.unshift(charges);
  return sha512(values.join("|"));
}
export function validPayUResponse(fields: PayUFields, key: string, salt: string) {
  if (!key || !salt || fields.key !== key || !/^[a-f0-9]{128}$/i.test(fields.hash ?? "") || fields.splitInfo || (fields.additional_charges && fields.additionalCharges && fields.additional_charges !== fields.additionalCharges)) return false;
  if (!["txnid", "amount", "productinfo", "firstname", "email", "status"].every(name => typeof fields[name] === "string" && fields[name].length > 0)) return false;
  return timingSafeEqual(Buffer.from(fields.hash, "hex"), Buffer.from(payuResponseHash(fields, salt), "hex"));
}
export function payuPaise(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
export type PayUTransaction = { status?: string; unmappedstatus?: string; mihpayid?: string | number; txnid?: string; amount?: string | number; transaction_amount?: string | number; amt?: string | number; productinfo?: string; email?: string; firstname?: string };
export function capturedPayUPayment(row: { txnid: string; amount: number; productinfo: string; email: string }, payment: PayUTransaction) {
  if (payment.status !== "success" || payment.unmappedstatus !== "captured" || !/^\d{1,40}$/.test(String(payment.mihpayid ?? ""))) return null;
  if (payment.txnid !== row.txnid || (typeof payment.mihpayid === "number" && !Number.isSafeInteger(payment.mihpayid))) return null;
  const amounts = [payment.amount, payment.transaction_amount, payment.amt].filter(v => v !== undefined);
  if (!amounts.length || amounts.some(v => payuPaise(v) !== row.amount)) return null;
  if (payment.productinfo !== row.productinfo || (payment.email != null && payment.email !== "" && payment.email.toLowerCase() !== row.email.toLowerCase())) return null;
  return String(payment.mihpayid);
}

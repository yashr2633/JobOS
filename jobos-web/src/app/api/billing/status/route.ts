import { createClient } from "@/lib/supabase/server";
import { billingDatabase, billingReady, billingMode } from "@/lib/billing/server";
import { hasCandidateProAccess } from "@/lib/recruiters/server";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try {
    const db = billingDatabase();
    const [access, subscription, payments, pro] = await Promise.all([
      db.rpc("billing_access_until", { p_user_id: user.id }),
      db.from("billing_subscriptions").select("id,plan_key,status,cancel_scheduled,created_at").eq("user_id", user.id).eq("mode", billingMode()).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("billing_payments").select("payment_id,amount,paid_at,valid_until,email_status").eq("user_id", user.id).eq("mode", billingMode()).order("paid_at", { ascending: false }).limit(12),
      hasCandidateProAccess(user.id),
    ]);
    if (access.error || subscription.error || payments.error) throw new Error("Billing unavailable.");
    const ids = (payments.data ?? []).map(payment => payment.payment_id);
    const refunds = ids.length ? await db.from("billing_refunds").select("payment_id,amount").in("payment_id", ids) : { data: [], error: null };
    if (refunds.error) throw new Error("Refund status unavailable.");
    const receipts = (payments.data ?? []).map(payment => ({ ...payment, refunded: (refunds.data ?? []).filter(refund => refund.payment_id === payment.payment_id).reduce((sum, refund) => sum + refund.amount, 0) }));
    return Response.json({ available: billingReady(), pro, paidUntil: access.data, subscription: subscription.data, payments: receipts }, { headers });
  } catch { return Response.json({ error: "Billing status could not load. Please retry shortly." }, { status: 503, headers }); }
}

# JobTrackOS Razorpay activation

Implemented prices: INR 349.00 monthly or INR 3,350.40 yearly (exactly 20% below 12 monthly payments). Price amounts are server constants in paise; checkout never accepts a client-supplied amount.

## Merchant setup still required

The existing Razorpay account is also used for a course. Keep its existing keys, plans and webhooks intact. Do not rotate an existing API secret to recover it. Use the existing saved credentials or a merchant-approved separate setup. Confirm this merchant can accept JobTrackOS subscriptions for jobtrackos.online.

Configure Vercel `jobtrackos` environment variables directly; never paste credentials into chat or commit them:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET` (Secret)
- `RAZORPAY_WEBHOOK_SECRET` (a separate strong random Secret, also entered on the Razorpay webhook)
- `RAZORPAY_CHECKOUT_ENABLED=true` only after integration testing and webhook setup.

Test keys belong to a Preview/Development environment. The production checkout rejects test keys. Test-mode payments are recorded separately and cannot grant production Pro access.

Create an additional Razorpay webhook with this URL:

`https://www.jobtrackos.online/api/billing/webhook`

Select subscription authenticated, activated, charged, pending, halted, paused, resumed, cancelled and completed events, plus `refund.processed`. Leave the course's webhook unchanged. The endpoint ignores subscriptions absent from JobTrackOS's private ledger. Use the matching test deployment URL and test secret for testing.

JobTrackOS creates separate named monthly/yearly plans when checkout first starts, then stores their identifiers. No existing course plan is edited. Keys are used only on the server; Checkout receives the public Key ID.

## Before enabling live checkout

1. Complete a Razorpay Test Mode purchase and confirm its subscription/payment/invoice agree.
2. Deliver the signed charged webhook; replay it and verify no duplicate purchase or email.
3. Test dismissal/failure, refreshing an uncertain payment, next-cycle charging, cancellation and full refund.
4. Confirm the branded confirmation email and billing status page.
5. Configure approved Live credentials and Live webhook; deploy, then enable checkout after the checks pass. Any real charge is completed by the account owner.

## Behaviour

- Signature validation alone never creates paid access. A captured payment, matching paid invoice, exact INR plan amount and bounded billing period are required.
- Purchases are immutable by payment ID. Duplicate delivery cannot extend a paid period. Subscription ownership and plan/mode are enforced by composite database foreign keys.
- An uncertain subscription-creation result is held for review instead of creating another mandate. Review `billing_subscriptions` rows in `review`/`creating` before clearing them.
- Cancellation stops future renewals; paid access expires at its original date. Full refunds remove that payment's access. Partial refunds retain the remaining paid access.
- Manual Pro grants remain separate. Billing cannot overwrite them.
- `Refresh status` reconciles recent provider invoices/refunds with the ledger. Webhooks handle automatic renewals.
- Receipt delivery is claimed once. `failed`, `sending` or `unknown` email records need operator review before retrying; the in-app payment record remains available.
- Billing tables and RPCs are service-only with RLS enabled. There are deliberately no direct browser policies.

Official references:
- https://razorpay.com/docs/payments/subscriptions/integration-guide
- https://razorpay.com/docs/webhooks/validate-test

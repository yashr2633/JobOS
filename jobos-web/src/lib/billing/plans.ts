export const BILLING_PLANS = {
  monthly: { name: "Monthly", amount: 34900, period: "monthly", cycles: 120, label: "₹349", suffix: "/month" },
  yearly: { name: "Yearly", amount: 335040, period: "yearly", cycles: 10, label: "₹3,350.40", suffix: "/year" },
} as const;
export type BillingPlan = keyof typeof BILLING_PLANS;
export const BILLING_SUPPORT_EMAIL = "kenilja946@gmail.com";
export const isBillingPlan = (value: unknown): value is BillingPlan => value === "monthly" || value === "yearly";
export const formatInr = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);

export type AdminPeriod = 7 | 28 | 90;
export interface AdminPerson { id: string; name: string | null; email: string | null; createdAt: string; lastActivity: string | null; lastSignIn: string | null; pro: boolean; source: string; employer: boolean }
export interface ProductRecord { id: string; user_id: string | null; event_name: string; properties: Record<string, string | number>; occurred_at: string }
export interface AdminSnapshot {
  version: 2; generatedAt: string; from: string; until: string; days: AdminPeriod; includeStaff: boolean; trackingSince: string | null; historicalTrackingSince: string | null;
  users: { registered: number; new: number; active: number; returning: number; activatedNew: number; proActive: number; paying: number };
  retention: { day: number; eligible: number; returned: number }[];
  trend: { day: string; signups: number; active: number }[];
  people: { page: number; pageSize: number; total: number; rows: AdminPerson[] };
  events: { event_name: string; events: number; users: number; sessions: number }[];
  sources: { source: string; pageViews: number; sessions: number; signups: number }[];
  campaigns: { source: string; campaign: string; page_views: number; sessions: number }[];
  funnel: { visits: number; jobViews: number; applyClicks: number; signedIn: number; employerOpens: number };
  resume: { uploads: number; analyses: number; complete: number; failed: number; users: number; averageSeconds: number | null; savedResumeDrafts: number; savedLetterDrafts: number };
  templates: { template: string; kind: string; tier: string; selections: number; exports: number }[];
  jobDemand: { location: string; searches: number }[];
  outreach: { contacts: number; companies: number };
  employers: { accounts: number; companies: number; jobs: number; submissions: number; stages: { stage: string; count: number }[] };
  revenue: { captured: number; grossPaise: number; recordedRefundPaise: number; checkoutStatuses: { status: string; count: number }[]; plans: { plan_key: string; purchases: number; amount: number }[]; payments: { id: string; provider: string; plan_key: string; amount: number; paid_at: string; valid_until: string }[]; expiring7d: number };
  alerts: { subscribers: number; deliveryStatuses: { status: string; count: number }[] };
  recent: ProductRecord[];
}

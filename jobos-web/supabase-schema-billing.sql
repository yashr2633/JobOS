-- Private payment ledger. Only the server can write purchases or read billing data.
create table if not exists public.billing_plan_catalog (
  plan_key text not null check (plan_key in ('monthly','yearly')),
  mode text not null check (mode in ('live','test')),
  provider_plan_id text not null unique,
  primary key (plan_key,mode)
);
create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null check (plan_key in ('monthly','yearly')),
  mode text not null check (mode in ('live','test')),
  provider_plan_id text not null,
  provider_subscription_id text unique,
  status text not null default 'creating',
  cancel_scheduled boolean not null default false,
  consent_version text not null default 'pro-renewal-v1',
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id,mode,plan_key)
);
create index if not exists billing_subscriptions_user on public.billing_subscriptions(user_id,created_at desc);
create unique index if not exists billing_one_open_checkout on public.billing_subscriptions(user_id,mode)
  where status in ('creating','review','created','authenticated','active','pending','halted','paused');
create table if not exists public.billing_payments (
  payment_id text primary key,
  subscription_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('live','test')),
  plan_key text not null check (plan_key in ('monthly','yearly')),
  amount integer not null check (amount in (34900,335040)),
  paid_at timestamptz not null,
  valid_until timestamptz not null,
  email_status text not null default 'pending' check (email_status in ('pending','sending','sent','failed','unknown')),
  created_at timestamptz not null default now(),
  foreign key(subscription_id,user_id,mode,plan_key) references public.billing_subscriptions(id,user_id,mode,plan_key),
  check(amount = case when plan_key='monthly' then 34900 else 335040 end)
);
create index if not exists billing_payments_user_expiry on public.billing_payments(user_id,valid_until desc);
create table if not exists public.billing_refunds (
  refund_id text primary key,
  payment_id text not null,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists billing_refunds_payment on public.billing_refunds(payment_id);
create table if not exists public.billing_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);
create table if not exists public.billing_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
create or replace function public.claim_billing_checkout(p_user_id uuid) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare claimed uuid;
begin
 insert into public.billing_locks(user_id,token,expires_at)
 values(p_user_id,gen_random_uuid(),now()+interval '90 seconds')
 on conflict(user_id) do update set token=excluded.token,expires_at=excluded.expires_at
 where public.billing_locks.expires_at < now()
 returning token into claimed;
 return claimed;
end; $$;
create or replace function public.billing_access_until(p_user_id uuid) returns timestamptz
language sql stable security invoker set search_path = public, pg_temp as $$
 select max(p.valid_until) from public.billing_payments p
 where p.user_id=p_user_id and p.mode='live' and p.valid_until>now()
 and p.amount > coalesce((select sum(r.amount) from public.billing_refunds r where r.payment_id=p.payment_id),0);
$$;
alter table public.billing_plan_catalog enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_locks enable row level security;
revoke all on public.billing_plan_catalog,public.billing_subscriptions,public.billing_payments,public.billing_refunds,public.billing_events,public.billing_locks from public,anon,authenticated;
grant select,insert,update,delete on public.billing_plan_catalog,public.billing_subscriptions,public.billing_payments,public.billing_refunds,public.billing_events,public.billing_locks to service_role;
revoke all on function public.claim_billing_checkout(uuid),public.billing_access_until(uuid) from public,anon,authenticated;
grant execute on function public.claim_billing_checkout(uuid),public.billing_access_until(uuid) to service_role;

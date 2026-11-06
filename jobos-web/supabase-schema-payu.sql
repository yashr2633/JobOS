-- PayU prepaid access. Existing Razorpay subscriptions remain intact.
create table public.billing_payu_checkouts (
 txnid text primary key check (txnid ~ '^jt[a-f0-9]{32}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_key text not null check (plan_key in ('monthly','yearly')),
 mode text not null check (mode in ('live','test')),
 amount integer not null check (amount > 0),
 email text not null, firstname text not null, phone text not null, productinfo text not null,
 status text not null default 'pending' check (status in ('pending','paid','failed','revoked')),
 provider_payment_id text unique,
 paid_at timestamptz, valid_until timestamptz,
 email_status text not null default 'pending' check (email_status in ('pending','sending','sent','failed','unknown')),
 created_at timestamptz not null default now(),
 check (amount = case when plan_key='monthly' then 34900 else 335040 end),
 check (status <> 'paid' or (provider_payment_id is not null and paid_at is not null and valid_until > paid_at))
);
create index billing_payu_user on public.billing_payu_checkouts(user_id,created_at desc);
create unique index billing_payu_pending on public.billing_payu_checkouts(user_id,mode,plan_key) where status='pending';
alter table public.billing_payu_checkouts enable row level security;
revoke all on public.billing_payu_checkouts from public,anon,authenticated;
grant select,insert,update,delete on public.billing_payu_checkouts to service_role;

create or replace function public.billing_access_until(p_user_id uuid) returns timestamptz
language sql stable security invoker set search_path=public,pg_temp as $$
 select max(valid_until) from (
  select p.valid_until from public.billing_payments p
  where p.user_id=p_user_id and p.mode='live' and p.valid_until>now()
   and p.amount>coalesce((select sum(r.amount) from public.billing_refunds r where r.payment_id=p.payment_id),0)
  union all
  select p.valid_until from public.billing_payu_checkouts p
  where p.user_id=p_user_id and p.mode='live' and p.status='paid' and p.valid_until>now()
 ) periods;
$$;
create function public.confirm_payu_purchase(p_txnid text,p_payment_id text) returns timestamptz
language plpgsql security invoker set search_path=public,pg_temp as $$
declare purchase public.billing_payu_checkouts%rowtype; starts_at timestamptz; expires_at timestamptz;
begin
 select * into purchase from public.billing_payu_checkouts where txnid=p_txnid for update;
 if not found then raise exception 'Unknown checkout'; end if;
 if p_payment_id !~ '^[0-9]{1,40}$' then raise exception 'Invalid payment ID'; end if;
 if purchase.status='paid' then
  if purchase.provider_payment_id<>p_payment_id then raise exception 'Payment mismatch'; end if;
  return purchase.valid_until;
 end if;
 if purchase.status='revoked' then raise exception 'Checkout revoked'; end if;
 perform pg_advisory_xact_lock(hashtextextended(purchase.user_id::text,0));
 starts_at:=greatest(now(),coalesce(public.billing_access_until(purchase.user_id),now()));
 expires_at:=starts_at+case when purchase.plan_key='monthly' then interval '1 month' else interval '1 year' end;
 update public.billing_payu_checkouts set status='paid',provider_payment_id=p_payment_id,paid_at=now(),valid_until=expires_at where txnid=p_txnid;
 return expires_at;
end;
$$;
revoke all on function public.confirm_payu_purchase(text,text),public.billing_access_until(uuid) from public,anon,authenticated;
grant execute on function public.confirm_payu_purchase(text,text),public.billing_access_until(uuid) to service_role;

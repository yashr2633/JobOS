create table if not exists public.recruiter_contacts (
  id uuid primary key default gen_random_uuid(),
  name text,
  company text not null check (length(trim(company)) between 1 and 200),
  title text,
  location text,
  email text not null unique check (email = lower(trim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  source text not null,
  approved_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists recruiter_contacts_directory_order
  on public.recruiter_contacts (company, name, id)
  where approved_at is not null and removed_at is null;

alter table public.recruiter_contacts enable row level security;
revoke all on public.recruiter_contacts from public, anon, authenticated;
grant select, insert, update on public.recruiter_contacts to service_role;

create table if not exists public.candidate_pro_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  valid_until timestamptz not null
);

alter table public.candidate_pro_access enable row level security;
revoke all on public.candidate_pro_access from public, anon, authenticated;
grant select, insert, update, delete on public.candidate_pro_access to service_role;

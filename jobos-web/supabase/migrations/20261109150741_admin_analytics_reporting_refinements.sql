create or replace function public.admin_product_analytics(
  p_users jsonb, p_days integer default 28, p_include_staff boolean default false,
  p_page integer default 1, p_query text default '', p_plan text default 'all'
) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare result jsonb; from_at timestamptz; until_at timestamptz;
begin
  if p_days not in (7,28,90) or p_page<1 or p_page>10000 or length(p_query)>80 or p_plan not in ('all','free','pro')
     or jsonb_typeof(p_users)<>'array' or jsonb_array_length(p_users)>100000 then raise exception 'Invalid analytics filters'; end if;
  from_at := (date_trunc('day',now() at time zone 'Asia/Kolkata')-make_interval(days=>p_days-1)) at time zone 'Asia/Kolkata';
  until_at := (date_trunc('day',now() at time zone 'Asia/Kolkata')+interval '1 day') at time zone 'Asia/Kolkata';
  with
  census as (select * from jsonb_to_recordset(p_users) as x(id uuid,email text,name text,created_at timestamptz,last_sign_in_at timestamptz,is_test boolean)),
  members as (select c.* from census c where p_include_staff or (not coalesce(c.is_test,false) and not exists(select 1 from public.admin_users a where a.user_id=c.id))),
  paid_records as (
    select 'payu:'||b.txnid as id,b.user_id,b.plan_key,b.amount,b.paid_at,b.valid_until,'PayU'::text as provider
    from public.billing_payu_checkouts b join members u on u.id=b.user_id where b.mode='live' and b.status='paid' and b.paid_at is not null
    union all
    select 'razorpay:'||b.payment_id,b.user_id,b.plan_key,b.amount,b.paid_at,b.valid_until,'Razorpay'
    from public.billing_payments b join members u on u.id=b.user_id where b.mode='live'
  ),
  paid as (select * from paid_records where paid_at>=from_at and paid_at<until_at),
  pro_users as (select u.id from members u where exists(select 1 from public.candidate_pro_access a where a.user_id=u.id and a.valid_until>now()) or public.billing_access_until(u.id)>now()),
  all_events as (select e.* from public.product_analytics_events e where e.occurred_at>=from_at and e.occurred_at<until_at and (e.user_id is null or exists(select 1 from members u where u.id=e.user_id))),
  events as (select * from all_events where occurred_at>=from_at and occurred_at<until_at),
  sessions as (
    select a.user_id,a.created_at as happened_at from public.analytics_events a join members u on u.id=a.user_id where a.event_name='user_session_activity' and a.created_at>=from_at and a.created_at<until_at
    union all select user_id,occurred_at from all_events where user_id is not null
  ),
  days_active as (select distinct user_id,(happened_at at time zone 'Asia/Kolkata')::date as active_day from sessions),
  period_sessions as (select * from sessions where happened_at>=from_at and happened_at<until_at),
  matches as (select m.id,m.user_id,m.status,m.created_at,m.started_at,m.completed_at from public.match_results m join members u on u.id=m.user_id where m.created_at>=from_at and m.created_at<until_at),
  core as (
    select user_id,created_at as happened_at from matches where status='complete'
    union all select user_id,occurred_at from events where event_name in ('document_exported','resume_tailored','letter_tailored','recruiter_unlocked','employer_open')
  ),
  first_source as (select distinct on (user_id) user_id,properties->>'source' as source,properties->>'campaign' as campaign from public.product_analytics_events where user_id is not null and properties ? 'source' and exists(select 1 from members u where u.id=user_id) order by user_id,occurred_at,id),
  people as (select u.*,p.id is not null as pro,coalesce(s.source,'Not tracked') as source,(select max(happened_at) from sessions a where a.user_id=u.id) as last_activity,
      exists(select 1 from public.employer_companies c where c.owner_id=u.id) as employer
    from members u left join pro_users p on p.id=u.id left join first_source s on s.user_id=u.id),
  filtered_people as (select * from people where (p_query='' or id::text=p_query or email ilike '%'||replace(replace(p_query,'%','\%'),'_','\_')||'%' or name ilike '%'||replace(replace(p_query,'%','\%'),'_','\_')||'%') and (p_plan='all' or (p_plan='pro' and pro) or (p_plan='free' and not pro))),
  people_page as (select * from filtered_people order by created_at desc,id limit 25 offset (p_page-1)*25),
  source_groups as (select coalesce(properties->>'source','direct') as source,count(*) as page_views,count(distinct session_id) as sessions from events where event_name='page_view' group by 1),
  source_signups as (select coalesce(s.source,'Not tracked') as source,count(*) as signups from members u left join first_source s on s.user_id=u.id where u.created_at>=from_at and u.created_at<until_at group by 1),
  event_groups as (select event_name,count(*) as events,count(distinct user_id) as users,count(distinct session_id) as sessions from events group by event_name),
  daily as (select day::date as day from generate_series((from_at at time zone 'Asia/Kolkata')::date,((until_at at time zone 'Asia/Kolkata')::date-1)::timestamp,interval '1 day') day),
  checkout_rows as (select b.* from public.billing_payu_checkouts b join members u on u.id=b.user_id where b.mode='live' and b.created_at>=from_at and b.created_at<until_at),
  refund_rows as (select r.* from public.billing_refunds r join public.billing_payments b on b.payment_id=r.payment_id join members u on u.id=b.user_id where b.mode='live' and r.created_at>=from_at and r.created_at<until_at),
  doc_files as (select o.name,o.created_at from storage.objects o join members u on split_part(o.name,'/',1)=u.id::text where o.bucket_id='resumes' and o.name like '%/documents/%.json'),
  period_resumes as (select r.id,r.user_id from public.resumes r join members u on u.id=r.user_id where r.created_at>=from_at and r.created_at<until_at),
  steps as (select session_id,min(occurred_at) filter(where event_name='page_view') as v,min(occurred_at) filter(where event_name='job_view') as j,min(occurred_at) filter(where event_name='apply_click') as a,min(occurred_at) filter(where user_id is not null and event_name in ('page_view','apply_click')) as l,min(occurred_at) filter(where event_name='employer_open') as o from events where session_id is not null group by session_id)
  select jsonb_build_object(
    'version',2,'generatedAt',now(),'from',from_at,'until',until_at,'days',p_days,'includeStaff',p_include_staff,
    'trackingSince',(select min(occurred_at) from public.product_analytics_events),
    'historicalTrackingSince',(select min(created_at) from public.analytics_events),
    'users',jsonb_build_object('registered',(select count(*) from members),'new',(select count(*) from members where created_at>=from_at and created_at<until_at),
      'active',(select count(distinct user_id) from period_sessions),'returning',(select count(*) from (select user_id from period_sessions group by user_id having count(distinct (happened_at at time zone 'Asia/Kolkata')::date)>1) x),
      'activatedNew',(select count(*) from members u where u.created_at>=from_at and u.created_at<until_at and exists(select 1 from core c where c.user_id=u.id and c.happened_at>=u.created_at)),
      'proActive',(select count(*) from pro_users),'paying',(select count(distinct user_id) from paid)),
    'retention',(select jsonb_agg(jsonb_build_object('day',d,'eligible',(select count(*) from members u where u.created_at>=from_at and u.created_at<until_at and (u.created_at at time zone 'Asia/Kolkata')::date+d < (now() at time zone 'Asia/Kolkata')::date),
      'returned',(select count(*) from members u where u.created_at>=from_at and u.created_at<until_at and (u.created_at at time zone 'Asia/Kolkata')::date+d < (now() at time zone 'Asia/Kolkata')::date and exists(select 1 from days_active a where a.user_id=u.id and a.active_day=(u.created_at at time zone 'Asia/Kolkata')::date+d)))) from unnest(array[1,7,30]) d),
    'trend',(select jsonb_agg(jsonb_build_object('day',d.day,'signups',(select count(*) from members u where (u.created_at at time zone 'Asia/Kolkata')::date=d.day),'active',(select count(*) from days_active a where a.active_day=d.day)) order by d.day) from daily d),
    'people',jsonb_build_object('page',p_page,'pageSize',25,'total',(select count(*) from filtered_people),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'createdAt',created_at,'lastActivity',last_activity,'lastSignIn',last_sign_in_at,'pro',pro,'source',source,'employer',employer) order by created_at desc,id) from people_page),'[]'::jsonb)),
    'events',coalesce((select jsonb_agg(to_jsonb(g) order by events desc,event_name) from event_groups g),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('source',coalesce(g.source,s.source),'pageViews',coalesce(g.page_views,0),'sessions',coalesce(g.sessions,0),'signups',coalesce(s.signups,0)) order by coalesce(g.page_views,0) desc) from source_groups g full join source_signups s using(source)),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(to_jsonb(c)) from (select properties->>'source' as source,properties->>'campaign' as campaign,count(*) as page_views,count(distinct session_id) as sessions from events where event_name='page_view' and properties ? 'campaign' group by 1,2 order by count(*) desc limit 30) c),'[]'::jsonb),
    'funnel',jsonb_build_object('visits',(select count(*) from steps where v is not null),'jobViews',(select count(*) from steps where v is not null and j>=v),'applyClicks',(select count(*) from steps where v is not null and j>=v and a>=j),'signedIn',(select count(*) from steps where v is not null and j>=v and a>=j and l is not null),'employerOpens',(select count(*) from steps where v is not null and j>=v and a>=j and l is not null and o>=a)),
    'resume',jsonb_build_object('uploads',(select count(*) from period_resumes),'analyses',(select count(*) from matches),'complete',(select count(*) from matches where status='complete'),'failed',(select count(*) from matches where status='failed'),'users',(select count(distinct user_id) from matches where status='complete'),
      'averageSeconds',(select round(avg(extract(epoch from completed_at-started_at))::numeric,1) from matches where status='complete' and completed_at>=started_at),
      'savedResumeDrafts',(select count(*) from doc_files where name like '%/documents/resume/%'),'savedLetterDrafts',(select count(*) from doc_files where name like '%/documents/letter/%')),
    'templates',coalesce((select jsonb_agg(to_jsonb(t)) from (select properties->>'template' as template,properties->>'kind' as kind,properties->>'plan' as tier,count(*) filter(where event_name='template_selected') as selections,count(*) filter(where event_name='document_exported') as exports from events where event_name in ('template_selected','document_exported') and properties ? 'template' group by 1,2,3 order by count(*) desc limit 30) t),'[]'::jsonb),
    'jobDemand',coalesce((select jsonb_agg(to_jsonb(t)) from (select properties->>'location' as location,count(*) as searches from events where event_name='job_search' and properties ? 'location' group by 1 order by count(*) desc limit 20) t),'[]'::jsonb),
    'outreach',jsonb_build_object('contacts',(select count(*) from public.recruiter_contacts where approved_at is not null and removed_at is null),'companies',(select count(distinct company) from public.recruiter_contacts where approved_at is not null and removed_at is null)),
    'employers',jsonb_build_object('accounts',(select count(distinct owner_id) from public.employer_companies c join members u on u.id=c.owner_id),'companies',(select count(*) from public.employer_companies c join members u on u.id=c.owner_id),
      'jobs',(select count(*) from public.employer_jobs j join public.employer_companies c on c.id=j.company_id join members u on u.id=c.owner_id where j.status='published' and (j.deadline is null or j.deadline>=current_date)),
      'submissions',(select count(*) from public.employer_submissions s join members u on u.id=s.candidate_id where s.created_at>=from_at and s.created_at<until_at),
      'stages',coalesce((select jsonb_agg(to_jsonb(x)) from (select s.stage,count(*) from public.employer_submissions s join members u on u.id=s.candidate_id where s.created_at>=from_at and s.created_at<until_at group by stage) x),'[]'::jsonb)),
    'revenue',jsonb_build_object('captured',(select count(*) from paid),'grossPaise',coalesce((select sum(amount) from paid),0),'recordedRefundPaise',coalesce((select sum(amount) from refund_rows),0),
      'checkoutStatuses',coalesce((select jsonb_agg(to_jsonb(x)) from (select status,count(*) from checkout_rows group by status) x),'[]'::jsonb),
      'plans',coalesce((select jsonb_agg(to_jsonb(x)) from (select plan_key,count(*) as purchases,sum(amount) as amount from paid group by plan_key) x),'[]'::jsonb),
      'payments',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,provider,plan_key,amount,paid_at,valid_until from paid order by paid_at desc,id limit 50) x),'[]'::jsonb),
      'expiring7d',(select count(*) from (select user_id,max(valid_until) as expires from paid_records group by user_id) x where expires>now() and expires<=now()+interval '7 days')),
    'alerts',jsonb_build_object('subscribers',(select count(*) from public.job_alert_preferences p join members u on u.id=p.user_id where email_enabled and email_consented_at is not null),'deliveryStatuses',coalesce((select jsonb_agg(to_jsonb(x)) from (select d.status,count(*) from public.job_alert_deliveries d join members u on u.id=d.user_id where d.created_at>=from_at and d.created_at<until_at group by d.status) x),'[]'::jsonb)),
    'recent',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,user_id,event_name,properties,occurred_at from events order by occurred_at desc,id limit 25) x),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_product_analytics(jsonb,integer,boolean,integer,text,text) from public,anon,authenticated;
grant execute on function public.admin_product_analytics(jsonb,integer,boolean,integer,text,text) to service_role;

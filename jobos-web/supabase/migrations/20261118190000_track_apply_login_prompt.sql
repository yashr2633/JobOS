alter table public.product_analytics_events
  drop constraint product_analytics_events_event_name_check,
  add constraint product_analytics_events_event_name_check check (
    event_name in (
      'page_view', 'job_search', 'job_view', 'apply_login_prompt', 'apply_click',
      'employer_open', 'template_selected', 'pro_view', 'checkout_open',
      'recruiter_view', 'outreach_draft_created', 'mail_composer_open',
      'document_saved', 'document_exported', 'resume_tailored', 'letter_tailored',
      'recruiter_unlocked', 'generation_failed'
    )
  );

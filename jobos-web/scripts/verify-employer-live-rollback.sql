-- Live verification only: all synthetic rows and changes are rolled back.
-- Uses two existing accounts as FK principals; never reads their resume content.
BEGIN;
SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE employer_smoke_context (owner_id uuid,candidate_id uuid,company_id uuid,job_id uuid,resume_id uuid,submission_id uuid);
ALTER TABLE employer_smoke_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY smoke_context_access ON employer_smoke_context TO authenticated
  USING(auth.uid() IN (owner_id,candidate_id)) WITH CHECK(auth.uid() IN (owner_id,candidate_id));
GRANT SELECT,UPDATE ON employer_smoke_context TO authenticated;
DO $$
DECLARE v_owner uuid; v_candidate uuid; v_company uuid; v_job uuid; v_resume uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at,id LIMIT 1;
  SELECT id INTO v_candidate FROM auth.users WHERE id<>v_owner ORDER BY created_at,id LIMIT 1;
  IF v_candidate IS NULL THEN RAISE EXCEPTION 'Two existing accounts required'; END IF;
  INSERT INTO public.employer_companies(owner_id,name) VALUES(v_owner,'Transaction-only verification') RETURNING id INTO v_company;
  INSERT INTO public.employer_jobs(company_id,title,location,work_mode,employment_type,description,status,published_at)
    VALUES(v_company,'Transaction-only verification role','India','Remote','Full-time',repeat('Synthetic verification description. ',3),'Published',now()) RETURNING id INTO v_job;
  INSERT INTO public.resumes(user_id,label,source,extracted_text,extraction_status)
    VALUES(v_candidate,'Transaction-only synthetic resume','paste','Synthetic candidate: SQL, spreadsheets and reporting. No actual candidate facts.','complete') RETURNING id INTO v_resume;
  INSERT INTO employer_smoke_context VALUES(v_owner,v_candidate,v_company,v_job,v_resume,NULL);
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT candidate_id::text FROM employer_smoke_context),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; v_submission uuid; v_retry uuid;
BEGIN
  SELECT * INTO c FROM employer_smoke_context;
  IF (SELECT count(*) FROM public.employer_jobs WHERE id=c.job_id)<>1 THEN RAISE EXCEPTION 'Published job unavailable'; END IF;
  BEGIN
    PERFORM public.submit_employer_application(c.job_id,c.resume_id,'Synthetic candidate','',false);
    RAISE EXCEPTION 'Missing consent was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Sign in and consent required' THEN RAISE; END IF;
  END;
  v_submission:=public.submit_employer_application(c.job_id,c.resume_id,'Synthetic candidate','',true);
  v_retry:=public.submit_employer_application(c.job_id,c.resume_id,'Synthetic candidate','',true);
  IF v_submission IS DISTINCT FROM v_retry THEN RAISE EXCEPTION 'Duplicate retry'; END IF;
  IF (SELECT count(*) FROM public.employer_submissions WHERE job_id=c.job_id)<>1 THEN RAISE EXCEPTION 'Duplicate submission'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.employer_submissions s JOIN public.applications a ON a.id=s.tracker_id WHERE s.id=v_submission AND a.user_id=c.candidate_id AND a.status='Applied') THEN RAISE EXCEPTION 'Tracker not linked'; END IF;
  BEGIN
    PERFORM public.set_employer_application_stage(v_submission,'Offer');
    RAISE EXCEPTION 'Candidate set employer stage';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'Application unavailable' THEN RAISE; END IF;
  END;
  UPDATE employer_smoke_context SET submission_id=v_submission WHERE job_id=c.job_id AND candidate_id=auth.uid();
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM employer_smoke_context),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM employer_smoke_context;
  IF NOT EXISTS(SELECT 1 FROM public.employer_submissions WHERE id=c.submission_id AND resume_text LIKE 'Synthetic candidate:%') THEN RAISE EXCEPTION 'Owner cannot read consented snapshot'; END IF;
  IF EXISTS(SELECT 1 FROM public.resumes WHERE id=c.resume_id) THEN RAISE EXCEPTION 'Owner accessed private resume'; END IF;
  PERFORM public.set_employer_application_stage(c.submission_id,'Interview');
  INSERT INTO public.employer_submission_notes(submission_id,note) VALUES(c.submission_id,'Transaction-only private note');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT candidate_id::text FROM employer_smoke_context),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM employer_smoke_context;
  IF NOT EXISTS(SELECT 1 FROM public.employer_submissions s JOIN public.applications a ON a.id=s.tracker_id WHERE s.id=c.submission_id AND a.status='Interview') THEN RAISE EXCEPTION 'Stage not reflected in tracker'; END IF;
  IF EXISTS(SELECT 1 FROM public.employer_submission_notes WHERE submission_id=c.submission_id) THEN RAISE EXCEPTION 'Candidate accessed private note'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.application_status_history h JOIN public.employer_submissions s ON s.tracker_id=h.application_id WHERE s.id=c.submission_id AND h.to_status='Interview') THEN RAISE EXCEPTION 'History not recorded'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: live submission, consent, retry deduplication, tracker, stage, history and private-access checks; all synthetic rows rolled back' AS result;

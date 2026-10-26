-- Additive employer workspace. Review and apply after existing tracker/resume migrations.
-- No production migration is performed by the UI implementation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.employer_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  website text NOT NULL DEFAULT '' CHECK (length(website) <= 500 AND (website = '' OR website ~ '^https://')),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.employer_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.employer_companies(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  location text NOT NULL CHECK (length(location) BETWEEN 2 AND 200),
  work_mode text NOT NULL CHECK (work_mode IN ('On-site','Hybrid','Remote')),
  employment_type text NOT NULL CHECK (employment_type IN ('Full-time','Part-time','Contract','Internship')),
  description text NOT NULL CHECK (length(description) BETWEEN 40 AND 45000),
  requirements text NOT NULL DEFAULT '' CHECK (length(requirements) <= 10000),
  salary text NOT NULL DEFAULT '' CHECK (length(salary) <= 200),
  deadline date,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Published','Paused','Closed')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.employer_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.employer_jobs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tracker_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  candidate_name text NOT NULL CHECK (length(candidate_name) BETWEEN 1 AND 160),
  candidate_email text NOT NULL CHECK (length(candidate_email) <= 320),
  resume_name text NOT NULL,
  resume_text text NOT NULL CHECK (length(resume_text) BETWEEN 1 AND 150000),
  cover_note text NOT NULL DEFAULT '' CHECK (length(cover_note) <= 5000),
  stage text NOT NULL DEFAULT 'New' CHECK (stage IN ('New','Review','Shortlisted','Interview','Offer','Rejected')),
  consent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,candidate_id)
);
CREATE TABLE IF NOT EXISTS public.employer_submission_notes (
  submission_id uuid PRIMARY KEY REFERENCES public.employer_submissions(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 5000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employer_jobs_company ON public.employer_jobs(company_id);
CREATE INDEX IF NOT EXISTS employer_jobs_published ON public.employer_jobs(status,published_at DESC);
CREATE INDEX IF NOT EXISTS employer_submissions_job ON public.employer_submissions(job_id);
CREATE INDEX IF NOT EXISTS employer_submissions_candidate ON public.employer_submissions(candidate_id);

ALTER TABLE public.employer_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_submission_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employer_companies, public.employer_jobs, public.employer_submissions, public.employer_submission_notes FROM anon;
REVOKE ALL ON public.employer_companies, public.employer_jobs, public.employer_submissions, public.employer_submission_notes FROM PUBLIC, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.employer_companies,public.employer_jobs TO authenticated;
GRANT SELECT ON public.employer_submissions TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.employer_submission_notes TO authenticated;

CREATE POLICY company_read ON public.employer_companies FOR SELECT TO authenticated USING (
  owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.employer_jobs j WHERE j.company_id=employer_companies.id AND j.status='Published' AND (j.deadline IS NULL OR j.deadline>=CURRENT_DATE))
);
CREATE POLICY company_create ON public.employer_companies FOR INSERT TO authenticated WITH CHECK(owner_id=auth.uid());
CREATE POLICY company_update ON public.employer_companies FOR UPDATE TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());

-- This ownership check runs as a fixed definer to avoid policy recursion between companies/jobs.
CREATE OR REPLACE FUNCTION public.owns_employer_company(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.employer_companies WHERE id=p_company AND owner_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.owns_employer_company(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owns_employer_company(uuid) TO authenticated;
CREATE POLICY job_read ON public.employer_jobs FOR SELECT TO authenticated USING (
  public.owns_employer_company(company_id) OR (status='Published' AND (deadline IS NULL OR deadline>=CURRENT_DATE))
);
CREATE POLICY job_create ON public.employer_jobs FOR INSERT TO authenticated WITH CHECK(public.owns_employer_company(company_id));
CREATE POLICY job_update ON public.employer_jobs FOR UPDATE TO authenticated USING(public.owns_employer_company(company_id)) WITH CHECK(public.owns_employer_company(company_id));

CREATE POLICY submission_read ON public.employer_submissions FOR SELECT TO authenticated USING (
  candidate_id=auth.uid() OR EXISTS(SELECT 1 FROM public.employer_jobs j WHERE j.id=job_id AND public.owns_employer_company(j.company_id))
);
CREATE POLICY note_read ON public.employer_submission_notes FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.employer_submissions s JOIN public.employer_jobs j ON j.id=s.job_id WHERE s.id=submission_id AND public.owns_employer_company(j.company_id))
);
CREATE POLICY note_insert ON public.employer_submission_notes FOR INSERT TO authenticated WITH CHECK (
  EXISTS(SELECT 1 FROM public.employer_submissions s JOIN public.employer_jobs j ON j.id=s.job_id WHERE s.id=submission_id AND public.owns_employer_company(j.company_id))
);
CREATE POLICY note_update ON public.employer_submission_notes FOR UPDATE TO authenticated USING (
  EXISTS(SELECT 1 FROM public.employer_submissions s JOIN public.employer_jobs j ON j.id=s.job_id WHERE s.id=submission_id AND public.owns_employer_company(j.company_id))
) WITH CHECK (
  EXISTS(SELECT 1 FROM public.employer_submissions s JOIN public.employer_jobs j ON j.id=s.job_id WHERE s.id=submission_id AND public.owns_employer_company(j.company_id))
);

-- Submit and tracker creation are atomic; direct client insertion is not granted.
CREATE OR REPLACE FUNCTION public.submit_employer_application(p_job uuid,p_resume uuid,p_name text,p_note text,p_consent boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_job public.employer_jobs%ROWTYPE; v_company text;
v_resume public.resumes%ROWTYPE; v_id uuid; v_tracker uuid; v_email text;
BEGIN
  IF v_user IS NULL OR p_consent IS DISTINCT FROM true THEN RAISE EXCEPTION 'Sign in and consent required'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 160 OR length(coalesce(p_note,''))>5000 THEN RAISE EXCEPTION 'Invalid application'; END IF;
  -- Serialize retries for the same candidate/job, including separate browser tabs.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||p_job::text,0));
  SELECT id INTO v_id FROM public.employer_submissions WHERE candidate_id=v_user AND job_id=p_job;
  IF FOUND THEN RETURN v_id; END IF;
  SELECT * INTO v_job FROM public.employer_jobs WHERE id=p_job FOR SHARE;
  IF NOT FOUND OR v_job.status<>'Published' OR (v_job.deadline IS NOT NULL AND v_job.deadline<CURRENT_DATE) THEN RAISE EXCEPTION 'This job is not accepting applications'; END IF;
  SELECT name INTO v_company FROM public.employer_companies WHERE id=v_job.company_id AND owner_id<>v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot apply to your own job'; END IF;
  SELECT * INTO v_resume FROM public.resumes WHERE id=p_resume AND user_id=v_user;
  IF NOT FOUND OR coalesce(length(trim(v_resume.extracted_text)),0)=0 OR length(v_resume.extracted_text)>150000 THEN RAISE EXCEPTION 'Select your own readable resume'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id=v_user;
  INSERT INTO public.applications(user_id,company,role,location,job_portal,applied_date,status,job_description,source)
    VALUES(v_user,v_company,v_job.title,v_job.location,'JobTrackOS',CURRENT_DATE,'Applied',v_job.description,'manual') RETURNING id INTO v_tracker;
  INSERT INTO public.application_status_history(user_id,application_id,from_status,to_status,source,note)
    VALUES(v_user,v_tracker,NULL,'Applied','manual','Applied directly through JobTrackOS.');
  INSERT INTO public.employer_submissions(job_id,candidate_id,tracker_id,candidate_name,candidate_email,resume_name,resume_text,cover_note)
    VALUES(p_job,v_user,v_tracker,trim(p_name),v_email,v_resume.label,v_resume.extracted_text,coalesce(p_note,'')) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_employer_application(uuid,uuid,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_employer_application(uuid,uuid,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_employer_application_stage(p_submission uuid,p_stage text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_submission public.employer_submissions%ROWTYPE; v_status text; v_old text;
BEGIN
  IF auth.uid() IS NULL OR p_stage IS NULL OR p_stage NOT IN ('New','Review','Shortlisted','Interview','Offer','Rejected') THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  SELECT s.* INTO v_submission FROM public.employer_submissions s JOIN public.employer_jobs j ON j.id=s.job_id
    JOIN public.employer_companies c ON c.id=j.company_id WHERE s.id=p_submission AND c.owner_id=auth.uid() FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable'; END IF;
  UPDATE public.employer_submissions SET stage=p_stage,updated_at=now() WHERE id=p_submission;
  v_status:=CASE p_stage WHEN 'Interview' THEN 'Interview' WHEN 'Offer' THEN 'Offer' WHEN 'Rejected' THEN 'Rejected' ELSE NULL END;
  IF v_status IS NOT NULL AND v_submission.tracker_id IS NOT NULL THEN
    SELECT status INTO v_old FROM public.applications WHERE id=v_submission.tracker_id AND user_id=v_submission.candidate_id FOR UPDATE;
    IF FOUND AND v_old<>v_status THEN
      UPDATE public.applications SET status=v_status,updated_at=now() WHERE id=v_submission.tracker_id AND user_id=v_submission.candidate_id;
      INSERT INTO public.application_status_history(user_id,application_id,from_status,to_status,source,note)
        VALUES(v_submission.candidate_id,v_submission.tracker_id,v_old,v_status,'manual','Employer updated the application stage in JobTrackOS.');
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_employer_application_stage(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_employer_application_stage(uuid,text) TO authenticated;
COMMIT;

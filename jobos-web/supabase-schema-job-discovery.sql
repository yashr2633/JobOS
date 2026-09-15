-- Job Discovery V1. Run AFTER the existing application/resume migrations.
-- No service role, OAuth changes, shared resume copies, or scheduled jobs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.career_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(preferences) = 'object' AND octet_length(preferences::text) <= 16000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.career_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS career_profile_owner ON public.career_profiles;
CREATE POLICY career_profile_owner ON public.career_profiles TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND (resume_id IS NULL OR EXISTS (
    SELECT 1 FROM public.resumes r WHERE r.id = resume_id AND r.user_id = auth.uid()
  )));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.career_profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.discovery_job_states (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL CHECK (length(job_id) BETWEEN 1 AND 150),
  saved BOOLEAN NOT NULL DEFAULT false,
  hidden BOOLEAN NOT NULL DEFAULT false,
  apply_started_at TIMESTAMPTZ,
  application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 300000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);
ALTER TABLE public.discovery_job_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discovery_state_owner ON public.discovery_job_states;
CREATE POLICY discovery_state_owner ON public.discovery_job_states TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND (application_id IS NULL OR EXISTS (
    SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()
  )));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_job_states TO authenticated;

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS discovery_job_id TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS application_url TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS discovery_source JSONB;
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_source_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_source_check
  CHECK (source IN ('manual', 'gmail', 'job_discovery'));
CREATE UNIQUE INDEX IF NOT EXISTS applications_discovery_identity
  ON public.applications(user_id, discovery_job_id) WHERE discovery_job_id IS NOT NULL;

-- Confirmation is atomic across tabs/retries, and writes the EXISTING tracker.
CREATE OR REPLACE FUNCTION public.confirm_discovery_application(p_job_id TEXT, p_applied_date DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_state public.discovery_job_states%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_applied_date IS NULL OR p_applied_date > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Invalid application date';
  END IF;
  SELECT * INTO v_state FROM public.discovery_job_states
    WHERE user_id = v_user AND job_id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_state.apply_started_at IS NULL THEN
    RAISE EXCEPTION 'Open the application page before confirming';
  END IF;
  IF v_state.application_id IS NOT NULL THEN RETURN v_state.application_id; END IF;
  INSERT INTO public.applications (
    user_id, company, role, location, job_portal, applied_date, status,
    job_description, source, discovery_job_id, application_url, discovery_source
  ) VALUES (
    v_user, v_state.snapshot->>'company', v_state.snapshot->>'title',
    coalesce(v_state.snapshot->>'location', ''), v_state.snapshot->>'source',
    p_applied_date, 'Applied', v_state.snapshot->>'description', 'job_discovery',
    p_job_id, v_state.snapshot->>'applicationUrl',
    jsonb_build_object('provider', v_state.snapshot->>'source', 'board', v_state.snapshot->>'board',
      'external_id', v_state.snapshot->>'externalId', 'source_url', v_state.snapshot->>'sourceUrl')
  ) ON CONFLICT (user_id, discovery_job_id) WHERE discovery_job_id IS NOT NULL
    DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.applications WHERE user_id = v_user AND discovery_job_id = p_job_id;
  ELSE
    INSERT INTO public.application_status_history (user_id, application_id, from_status, to_status, source, note)
      VALUES (v_user, v_id, NULL, 'Applied', 'manual', 'Confirmed applied from Job Discovery.');
  END IF;
  UPDATE public.discovery_job_states SET application_id = v_id, saved = true, updated_at = now()
    WHERE user_id = v_user AND job_id = p_job_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_discovery_application(TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_discovery_application(TEXT, DATE) TO authenticated;

-- Existing Resume Match pipeline can analyze a discovered job before applying.
-- A preview is a match_results row, NEVER a fake Applied application.
ALTER TABLE public.match_results ADD COLUMN IF NOT EXISTS discovery_job_id TEXT;
ALTER TABLE public.match_results ALTER COLUMN application_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_result_target' AND conrelid = 'public.match_results'::regclass) THEN
    ALTER TABLE public.match_results ADD CONSTRAINT match_result_target
      CHECK (application_id IS NOT NULL OR discovery_job_id IS NOT NULL);
  END IF;
END $$;
COMMIT;

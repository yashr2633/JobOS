-- Apply after the existing schema. All existing users remain unsubscribed.
BEGIN;
CREATE TABLE public.job_alert_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email_enabled boolean NOT NULL DEFAULT false,
 whatsapp_requested boolean NOT NULL DEFAULT false,
 frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily','weekly')),
 query text NOT NULL DEFAULT '' CHECK(length(query)<=100),
 location text NOT NULL DEFAULT 'India' CHECK(length(location)<=100),
 consent_version text NOT NULL DEFAULT 'job-alerts-v1',
 email_consented_at timestamptz,
 whatsapp_consented_at timestamptz,
 unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_checked_at timestamptz NOT NULL DEFAULT 'epoch',
 last_sent_at timestamptz
);
CREATE TABLE public.job_alert_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 job_keys text[] NOT NULL,
 status text NOT NULL CHECK(status IN ('sending','accepted','failed','unknown')),
 provider_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_alert_delivery_owner ON public.job_alert_deliveries(user_id,created_at);
CREATE TABLE public.job_alert_worker (
 id int PRIMARY KEY CHECK(id=1), lease_until timestamptz NOT NULL DEFAULT 'epoch'
);
INSERT INTO public.job_alert_worker(id) VALUES(1);
ALTER TABLE public.job_alert_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_alert_worker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_alert_preferences, public.job_alert_deliveries, public.job_alert_worker FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_alert_preferences, public.job_alert_deliveries, public.job_alert_worker TO service_role;
CREATE TABLE public.job_alert_consent_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 email_enabled boolean NOT NULL, whatsapp_requested boolean NOT NULL,
 consent_version text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_alert_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_alert_consent_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.job_alert_consent_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.job_alert_consent_events_id_seq TO service_role;
CREATE FUNCTION public.record_job_alert_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.job_alert_consent_events(user_id,email_enabled,whatsapp_requested,consent_version)
  VALUES(NEW.user_id,NEW.email_enabled,NEW.whatsapp_requested,NEW.consent_version);
 ELSIF NEW.email_enabled IS DISTINCT FROM OLD.email_enabled OR NEW.whatsapp_requested IS DISTINCT FROM OLD.whatsapp_requested OR NEW.consent_version IS DISTINCT FROM OLD.consent_version THEN
  INSERT INTO public.job_alert_consent_events(user_id,email_enabled,whatsapp_requested,consent_version)
  VALUES(NEW.user_id,NEW.email_enabled,NEW.whatsapp_requested,NEW.consent_version);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_job_alert_consent() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER job_alert_consent_audit AFTER INSERT OR UPDATE ON public.job_alert_preferences
 FOR EACH ROW EXECUTE FUNCTION public.record_job_alert_consent();
-- All access passes through server endpoints bound to auth.getUser().
CREATE FUNCTION public.claim_job_alert_worker() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 UPDATE public.job_alert_worker SET lease_until=now()+interval '5 minutes'
 WHERE id=1 AND lease_until<now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_job_alert_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_alert_worker() TO service_role;
COMMIT;

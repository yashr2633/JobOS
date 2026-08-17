-- ============================================================================
-- Sprint 12: applications.source — how an application came to exist
-- ============================================================================
--
-- WHY THIS MIGRATION IS NECESSARY
--
-- "Reset tracked Gmail applications" has to delete the applications Gmail
-- CREATED while preserving the ones the user created by hand. No existing column
-- can answer that:
--
--   * `gmail_message_id` is set by BOTH paths. `applyCreate` sets it on a
--     Gmail-created application, and `applyLink` backfills it onto a MANUAL
--     application when Gmail evidence matches one. Deleting on this column would
--     delete manual applications — the exact outcome the feature must prevent.
--
--   * `job_portal` is free text a user can type. "Gmail", "LinkedIn" and "Manual"
--     are conventions, not guarantees, so it cannot carry a deletion decision.
--
--   * `application_status_history.source` records who changed a STATUS, not who
--     created the row, and `applyCreate` writes no history row at all.
--
-- So origin is recorded explicitly, once, at insert time.
--
-- SAFETY PROPERTIES
--
--   * Additive only. No column is dropped, renamed, or retyped.
--   * DEFAULT 'manual' is the SAFE default: anything whose origin is unknown is
--     never eligible for automatic deletion.
--   * Re-runnable (IF NOT EXISTS + guarded constraint), so applying it twice is
--     a no-op rather than an error.
--   * Touches no Gmail table, no resume table, and no RLS policy.
--
-- BACKFILL, AND ITS ONE HONEST CAVEAT
--
-- Rows written before this column existed carry no origin. The best available
-- signal is `gmail_message_id IS NOT NULL`, so those are backfilled to 'gmail'.
--
-- CAVEAT: a MANUAL application that Gmail later linked evidence to also has a
-- `gmail_message_id`, so the backfill classifies it as 'gmail'. That is
-- unavoidable for historical rows — the information needed to tell them apart was
-- never recorded. It is mitigated in the product, not here: the reset flow reports
-- exactly how many applications it will remove and requires explicit
-- confirmation. Rows written from now on are classified at insert time and carry
-- no ambiguity.

ALTER TABLE public.applications
  -- 'manual' = created by the user (Applications form, Resume Match).
  -- 'gmail'  = created by the Gmail import paths (Auto_Importer, review import).
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Constraint added separately so re-running cannot fail with "already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.applications'::regclass
       AND conname  = 'applications_source_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_source_check
      CHECK (source IN ('manual', 'gmail'));
  END IF;
END $$;

-- Backfill historical rows from the only signal available. Bounded to rows still
-- carrying the default, so re-running never reclassifies a row the application
-- layer has since written authoritatively.
UPDATE public.applications
   SET source = 'gmail'
 WHERE source = 'manual'
   AND gmail_message_id IS NOT NULL;

-- The reset deletes by (user_id, source), so that is the index.
CREATE INDEX IF NOT EXISTS idx_applications_user_source
  ON public.applications(user_id, source);

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'applications'
--    AND column_name = 'source';
--
-- SELECT source, COUNT(*) FROM public.applications GROUP BY source;

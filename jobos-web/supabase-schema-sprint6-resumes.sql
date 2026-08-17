-- JobOS Sprint 6 Migration: Resume Upload Storage
-- Run this SQL in your Supabase SQL Editor AFTER supabase-schema-sprint5.sql
--
-- The `resumes` table itself already exists (added in Sprint 5) and needs no
-- changes: it already has file_name, file_path, extracted_text, and the
-- extraction/parse status columns needed for uploaded files. This migration
-- only adds the private Storage bucket + Storage RLS policies so uploaded
-- resume files can be stored securely, scoped to the uploading user.
--
-- This migration is ADDITIVE and IDEMPOTENT.

-- ============================================================================
-- 1. Private storage bucket for resume files
-- ============================================================================
-- `public = false` means files are NOT served over a public URL. Every read
-- must go through a signed URL or an authenticated request that satisfies
-- the RLS policies below.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('resumes', 'resumes', false, 10485760) -- 10 MB
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. Storage RLS: users may only read/write objects inside their own folder
-- ============================================================================
-- Uploaded files are stored at `<user_id>/<uuid>-<filename>`, so the first
-- path segment is always the owning user's id. Comparing that segment to
-- auth.uid() is equivalent to the user_id column check used on every other
-- table in this schema.

DROP POLICY IF EXISTS "Users can read their own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own resume files" ON storage.objects;

CREATE POLICY "Users can read their own resume files"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can upload their own resume files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update their own resume files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete their own resume files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'resumes';
--
-- SELECT policyname FROM pg_policies
--  WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND policyname LIKE '%resume files%';

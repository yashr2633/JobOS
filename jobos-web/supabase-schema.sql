-- JobOS Database Schema for Supabase
-- Run this SQL in your Supabase SQL Editor

-- Create applications table
CREATE TABLE IF NOT EXISTS public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL,
  job_portal TEXT NOT NULL,
  applied_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted')),
  salary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON public.applications(created_at DESC);

-- Create trigger function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
DROP TRIGGER IF EXISTS update_applications_updated_at ON public.applications;
CREATE TRIGGER update_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can insert their own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update their own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can delete their own applications" ON public.applications;

-- Create RLS policies
CREATE POLICY "Users can view their own applications"
  ON public.applications
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own applications"
  ON public.applications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own applications"
  ON public.applications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own applications"
  ON public.applications
  FOR DELETE
  USING (auth.uid() = user_id);

-- Optional: Insert sample data for testing (replace 'your-user-id' with your actual user ID after signup)
-- You can get your user ID by running: SELECT id FROM auth.users WHERE email = 'your-email@example.com';
/*
INSERT INTO public.applications (user_id, company, role, location, job_portal, applied_date, status, salary) VALUES
  ('your-user-id', 'Google', 'Software Engineer', 'Mountain View, CA', 'LinkedIn', '2026-07-28', 'Applied', '$150k – $180k'),
  ('your-user-id', 'Stripe', 'Backend Engineer', 'Remote', 'Company Website', '2026-07-22', 'Interview', '$160k – $200k'),
  ('your-user-id', 'Netflix', 'Senior Software Engineer', 'Los Gatos, CA', 'LinkedIn', '2026-07-15', 'Applied', '$180k – $220k');
*/

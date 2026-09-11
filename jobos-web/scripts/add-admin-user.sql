-- Add first admin user to JobTrackOS Analytics
-- Run this in Supabase SQL Editor AFTER running supabase-analytics-schema.sql

-- Step 1: Find your user ID
SELECT id, email FROM auth.users WHERE email = 'YOUR_EMAIL_HERE';

-- Step 2: Copy the ID from the result and paste it below
-- Replace YOUR_USER_ID_HERE with the actual UUID

-- INSERT INTO public.admin_users (user_id)
-- VALUES ('YOUR_USER_ID_HERE')
-- ON CONFLICT (user_id) DO NOTHING;

-- Step 3: Verify admin was added
-- SELECT u.email, a.created_at
-- FROM public.admin_users a
-- JOIN auth.users u ON u.id = a.user_id;

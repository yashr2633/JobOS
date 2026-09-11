# JobTrackOS Analytics Setup Guide

## Overview

This guide covers setting up the founder analytics dashboard for JobTrackOS. The analytics system provides privacy-safe product metrics for beta testing and investor reporting.

## Architecture

**Design Principles:**
- **Source of Truth**: Existing tables remain authoritative (applications, resumes, gmail_sync_jobs, etc.)
- **Minimal Tracking**: Only tracks user_session_activity (authenticated sessions)
- **Privacy-Safe**: No sensitive data (email content, tokens, PII) is logged
- **Non-Blocking**: Analytics failures never break product functionality
- **Admin-Only**: Dashboard access restricted via allowlist

**What Gets Tracked:**
- ✅ User authenticated sessions (one per user per UTC day)
- ❌ NOT tracked: page views, clicks, Gmail content, resume content, tokens

**Metrics Derived from Existing Tables:**
- User registrations → `auth.users`
- Applications → `applications` table
- Gmail syncs → `gmail_sync_jobs` table
- Resume analyses → `match_results` table
- Resumes → `resumes` table

## Setup Steps

### 1. Run Database Migration

Open Supabase SQL Editor and run:

```bash
# In Supabase Dashboard:
# 1. Go to SQL Editor
# 2. Create new query
# 3. Paste contents of supabase-analytics-schema.sql
# 4. Click "Run"
```

This creates:
- `admin_users` - Admin authorization allowlist
- `analytics_events` - Session activity tracking

### 2. Add Your Admin User

Find your user ID:

```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

Add yourself as admin:

```sql
INSERT INTO public.admin_users (user_id)
VALUES ('YOUR_USER_ID_HERE')
ON CONFLICT (user_id) DO NOTHING;
```

### 3. Verify Setup

Check tables exist:

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('admin_users', 'analytics_events');
```

Verify RLS is enabled:

```sql
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('admin_users', 'analytics_events');
```

### 4. Update Tracking Since Date

Edit `src/lib/analytics/metrics.ts` and update:

```typescript
const TRACKING_SINCE = '2026-09-11'; // Change to today's date
```

### 5. Deploy to Production

```bash
npm run build
# Verify no build errors

# Deploy via your preferred method (Vercel, etc.)
```

### 6. Test Access

**Test Admin Access:**
1. Navigate to `/admin/analytics`
2. Should see dashboard with metrics
3. Verify all sections load

**Test Non-Admin Access:**
1. Log in as a different user
2. Navigate to `/admin/analytics`
3. Should see 403 Forbidden page

**Test Event Tracking:**
1. Log out
2. Log in again
3. Check browser console - no errors
4. Analytics failures should be logged but not thrown

## Dashboard Metrics

The `/admin/analytics` dashboard shows:

### User Metrics
- **Total Registered Users** - from `auth.users`
- **New Users (7d/30d)** - signups in period
- **Active Users (7d/30d)** - authenticated sessions ⭐
- **Engaged Users (7d/30d)** - meaningful product actions
- **Returning Users** - users active on 2+ days ⭐

⭐ = Tracking since deployment date

### Feature Adoption
- **Gmail Connected** - users with active connections
- **Resume Match Users** - users who completed analyses

### Activity
- **Applications Created**
- **Gmail Syncs Completed**
- **Resume Analyses**
- **Resumes Uploaded**

### Charts
- **Applications by Status** - breakdown
- **Signup Trend** - last 30 days

## Metric Definitions

### Active User
A user who opened an authenticated JobTrackOS session on a distinct UTC day.
- Tracks app logins/sessions
- Does NOT measure meaningful engagement
- One event per user per calendar day (server-enforced)

### Engaged User
A user who performed at least one meaningful product action:
- Created an application
- Completed a Gmail sync
- Completed a Resume Match analysis
- Uploaded/created a resume

Derived from existing tables, no special tracking needed.

### Returning User
A registered user with authenticated activity on at least 2 distinct UTC dates.
- Measures genuine re-engagement
- Excludes same-day activity
- Available since tracking deployment

## Security

**Admin Authorization:**
- Admin access controlled by `admin_users` allowlist table
- No client-accessible RLS policies on admin_users
- Checked server-side via service role client
- User metadata is NOT used for auth

**Event Access:**
- Users can INSERT their own events only
- Users CANNOT SELECT any events (including their own)
- Only admin routes via service role can read events

**Privacy:**
- No email content, subjects, or recipients logged
- No Gmail OAuth tokens logged
- No resume or job description content logged
- No PII in analytics_events

**Rate Limiting:**
- One `user_session_activity` per user per UTC day
- Enforced by database unique constraint
- Concurrent requests safely deduplicated

## Troubleshooting

### "Unauthorized" when accessing /admin/analytics

**Cause**: Not logged in
**Solution**: Log in first, then navigate to `/admin/analytics`

### "Forbidden" when accessing /admin/analytics

**Cause**: User not in `admin_users` table
**Solution**: 
```sql
INSERT INTO public.admin_users (user_id) VALUES ('YOUR_USER_ID');
```

### Analytics shows all zeros

**Cause 1**: Analytics just deployed, no data yet
**Solution**: Wait for users to log in and use product

**Cause 2**: Tracking since date is in future
**Solution**: Update `TRACKING_SINCE` in `src/lib/analytics/metrics.ts`

### Event tracking failing in browser console

**Cause**: Normal - analytics is non-blocking
**Solution**: Check server logs for actual errors, but product should work fine

### Dashboard won't load

**Check**: Browser console for errors
**Check**: `/api/admin/analytics` returns JSON (not HTML error page)
**Check**: Server logs for metric aggregation errors

## Adding More Admins

```sql
-- Add another admin
INSERT INTO public.admin_users (user_id)
SELECT id FROM auth.users WHERE email = 'another-admin@example.com'
ON CONFLICT (user_id) DO NOTHING;

-- Remove admin
DELETE FROM public.admin_users 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'removed@example.com');

-- List all admins
SELECT u.email, a.created_at
FROM public.admin_users a
JOIN auth.users u ON u.id = a.user_id;
```

## Maintenance

**Regular Tasks:**
- None required - metrics auto-aggregate from existing tables

**Optional:**
- Review admin_users list periodically
- Monitor analytics_events table size (should be ~1 row per user per day)

**Data Retention:**
- `analytics_events` accumulates indefinitely (small growth rate)
- To archive old events: backup and truncate periodically if needed

## Privacy Notes

**What Analytics NEVER Stores:**
- ❌ Email content or subjects
- ❌ Gmail sender/recipient addresses
- ❌ Resume contents
- ❌ Job description contents
- ❌ OAuth tokens or credentials
- ❌ User email addresses (in analytics_events)
- ❌ Individual Gmail addresses (in dashboard)

**What Analytics DOES Store:**
- ✅ User IDs (UUIDs)
- ✅ Event timestamps
- ✅ Session dates (YYYY-MM-DD)
- ✅ Aggregate counts only

The dashboard shows **aggregate metrics only** - no individual user details are exposed.

## Support

For issues or questions:
1. Check this guide
2. Review error logs
3. Verify SQL migration ran successfully
4. Confirm admin_users entry exists

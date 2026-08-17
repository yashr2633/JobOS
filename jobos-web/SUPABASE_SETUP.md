# 🚀 Sprint 4: Supabase Setup Instructions

## ✅ Build Status
- **TypeScript**: 0 errors
- **Build**: ✅ Successful
- **Pages Generated**: Dashboard, Applications, Login, Signup, OAuth Callback

---

## 📋 Prerequisites

1. A Supabase account (free tier works)
2. Node.js installed (already have it)
3. Git configured (already have it)

---

## 🔧 Step 1: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Click **"Start your project"** or **"New Project"**
3. Fill in project details:
   - **Organization**: Create new or select existing
   - **Project Name**: `jobos` (or any name you prefer)
   - **Database Password**: Create a strong password (SAVE THIS!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free tier is sufficient

4. Click **"Create new project"**
5. Wait 2-3 minutes for project provisioning

---

## 🗄️ Step 2: Set Up Database Schema

1. In your Supabase project dashboard, go to **SQL Editor** (left sidebar)
2. Click **"New Query"**
3. Copy the entire contents of `supabase-schema.sql` from this repo
4. Paste into the SQL editor
5. Click **"Run"** (or press Ctrl+Enter)

✅ You should see: "Success. No rows returned"

This creates:
- `applications` table with proper structure
- Row Level Security (RLS) policies
- Indexes for performance
- Auto-update triggers

---

## 🔑 Step 3: Get Your API Credentials

1. In Supabase dashboard, go to **Settings** > **API** (left sidebar)
2. Find these two values:

### Project URL
```
URL: https://xxxxxxxxxxxxx.supabase.co
```
Copy this entire URL

### Publishable Key
```
publishable key: sb_publishable_xxxxxxxxxxxxxxxxxxxx
```
Older projects instead expose a legacy `anon public` JWT (`eyJhbGciOi...`). Either
works — the app reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` first and falls back
to `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

⚠️ **IMPORTANT**: The publishable/anon key is safe to use in browser code. DO NOT use the `secret`/`service_role` key!

---

## 🔐 Step 4: Configure Google OAuth (Optional but Recommended)

### Enable Google Provider

1. In Supabase dashboard, go to **Authentication** > **Providers**
2. Find **Google** in the list
3. Toggle it **ON**
4. You'll need:
   - Google Client ID
   - Google Client Secret

### Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Go to **APIs & Services** > **Credentials**
4. Click **"Create Credentials"** > **"OAuth 2.0 Client ID"**
5. Choose **"Web application"**
6. Add Authorized redirect URIs:
   ```
   https://xxxxxxxxxxxxx.supabase.co/auth/v1/callback
   ```
   (Replace `xxxxxxxxxxxxx` with your Supabase project ID)
7. Copy the **Client ID** and **Client Secret**

### Add to Supabase

1. Back in Supabase **Authentication** > **Providers** > **Google**
2. Paste **Client ID**
3. Paste **Client Secret**
4. Click **"Save"**

---

## 📝 Step 5: Set Environment Variables

1. Open `c:\Users\hp\Desktop\jobos\jobos-web\.env.local` in any text editor
2. Replace the placeholder values with your actual credentials:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx
```

⚠️ **CRITICAL**: These values MUST be exact - copy-paste from Supabase dashboard!

### Email confirmation codes with Resend SMTP

The application uses Supabase Auth for both issuing and verifying email codes. It
never generates or stores OTPs locally. Password signup calls `signUp` without an
email redirect option, then verifies the submitted code with
`verifyOtp({ email, token, type: "signup" })`. The login code path uses
`signInWithOtp({ email, options: { shouldCreateUser: false } })` and verifies with
type `"email"`; this also works for an existing Google-created account without
silently creating a user.

In Supabase Dashboard, configure the following before testing signup or email-code
login:

1. **Authentication → Providers → Email**: enable Email. Keep email confirmation
   enabled if signup must require verification, and keep signups enabled.
2. **Authentication → SMTP Settings**: configure the Resend SMTP credentials
   using your verified sending domain:
   - Host: `smtp.resend.com`
   - Port: `465` (TLS) or `587` (STARTTLS), according to the Supabase form
   - Username: `resend`
   - Password: a Resend API key (store it only in Supabase, never in this repo)
   - Sender address: an address on a domain verified in Resend
3. **Authentication → Email Templates → Confirm signup**: use the OTP token
   placeholder `{{ .Token }}` in the email body. Do not make the signup flow
   depend on `{{ .ConfirmationURL }}`; that is the link-based flow and is not what
   the application asks the user to enter.
4. Add the deployed site origin to Supabase **Authentication → URL Configuration**
   (and `http://localhost:3000` for local testing). The callback URL is still used
   by Google OAuth; email-code signup and login do not add a redirect URL.

If Supabase returns `Error sending confirmation email`, the application now shows
an actionable configuration message, but SMTP delivery, sender-domain
verification, provider limits, and the email template can only be corrected in
Supabase/Resend. A live email delivery check is still required after these
settings are applied.

### Verify the connection

```bash
node scripts/check-supabase.mjs
```

This reports project reachability, enabled auth providers, whether email
confirmation is required, and whether the `applications` table exists.

---

## 🎯 Step 6: Verify Setup

### Start Development Server

```bash
cd c:\Users\hp\Desktop\jobos\jobos-web
npm run dev
```

### Test Authentication Flow

1. **Open browser**: `http://localhost:3000`
2. **You should be redirected to**: `/login`
3. **Test Email Signup**:
   - Click "Sign up"
   - Enter email & password (min 6 characters)
   - Click "Sign up"
   - Should redirect to dashboard
4. **Test Logout**:
   - Click "Log out" in navbar
   - Should redirect back to login
5. **Test Email Login**:
   - Enter same email & password
   - Click "Log in"
   - Should access dashboard
6. **Test Google Login** (if configured):
   - Click "Continue with Google"
   - Authorize with Google account
   - Should redirect to dashboard

---

## 🧪 Step 7: Test CRUD Operations

Once logged in:

### Create Application
1. Go to **Applications** page
2. Click **"Add Application"**
3. Fill in form:
   - Company: "Test Company"
   - Role: "Test Role"
   - Location: "Remote"
   - Job Portal: "LinkedIn"
   - Applied Date: (any date)
   - Status: "Applied"
   - Salary: "$100k"
4. Click **"Add Application"**
5. ✅ Should appear in list

### Edit Application
1. Click menu (3 dots) on any application
2. Click **"Edit"**
3. Change company name
4. Click **"Save Changes"**
5. ✅ Should update in list

### Delete Application
1. Click menu (3 dots)
2. Click **"Delete"**
3. Confirm deletion
4. ✅ Should disappear from list

### Duplicate Application
1. Click menu (3 dots)
2. Click **"Duplicate"**
3. ✅ Copy should appear with " (Copy)" suffix

---

## 🔍 Step 8: Verify Data in Supabase

1. Go to Supabase dashboard
2. Click **Table Editor** (left sidebar)
3. Select **applications** table
4. ✅ You should see your test applications with:
   - Your user_id
   - All field data
   - created_at and updated_at timestamps

---

## 🐛 Troubleshooting

### "Failed to fetch" or connection errors

**Problem**: Can't connect to Supabase
**Solution**:
1. Check `.env.local` has correct URL and key
2. Restart dev server: `npm run dev`
3. Hard refresh browser: Ctrl+Shift+R
4. Check Supabase project is active (not paused)

### "User not authenticated" errors

**Problem**: RLS policies blocking access
**Solution**:
1. Verify RLS policies were created (run schema SQL again)
2. Check user is logged in (see email in navbar)
3. Try logging out and back in

### Google OAuth not working

**Problem**: Redirect URI mismatch
**Solution**:
1. Check redirect URI in Google Console matches exactly:
   ```
   https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback
   ```
2. Make sure Google provider is enabled in Supabase
3. Check Client ID and Secret are correct

### Build errors after adding Supabase

**Problem**: TypeScript or build errors
**Solution**:
1. Delete `.next` folder
2. Run `npm run build` again
3. Check all imports use `@/lib/...` syntax

### "Invalid API key" or 401 errors

**Problem**: Wrong API key
**Solution**:
1. Make sure you copied the **anon** key, not service_role
2. Check for extra spaces or line breaks in `.env.local`
3. Restart dev server after changing env vars

---

## ✅ Success Checklist

- [ ] Supabase project created
- [ ] Database schema executed
- [ ] API credentials copied to `.env.local`
- [ ] Google OAuth configured (optional)
- [ ] Dev server running (`npm run dev`)
- [ ] Can sign up with email
- [ ] Can log in with email
- [ ] Can log out
- [ ] Can create application
- [ ] Can edit application
- [ ] Can delete application
- [ ] Can see data in Supabase table
- [ ] Dashboard shows real data
- [ ] No console errors

---

## 📚 Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Next.js + Supabase](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)

---

## 🔒 Security Notes

1. **Never commit `.env.local`** - it's in .gitignore already
2. **Never expose service_role key** - only use anon key in frontend
3. **RLS is enforced** - users can only see their own data
4. **Passwords are hashed** - Supabase handles security
5. **OAuth tokens are secure** - stored as HTTP-only cookies

---

## 🎉 You're All Set!

Sprint 4 is complete! You now have:
- ✅ Full authentication (email + Google)
- ✅ Real database storage
- ✅ User-specific data isolation
- ✅ Secure CRUD operations
- ✅ Protected routes
- ✅ All Sprint 2 & 3 features preserved

**Next Steps**:
- Add more applications
- Invite team members
- Deploy to production (Vercel recommended)
- Add more features (reminders, notes, etc.)

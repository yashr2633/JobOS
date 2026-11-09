/**
 * Admin section layout with server-side authorization guard.
 *
 * All /admin/* routes are protected. Non-admins are redirected to forbidden page.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/analytics/admin';
import './analytics/admin-analytics.css';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Require authentication
  if (!user) {
    redirect('/login?next=/admin/analytics');
  }

  // Require admin authorization
  const authorized = await isAdmin(user.id);
  if (!authorized) {
    redirect('/admin/forbidden');
  }

  return <>{children}</>;
}

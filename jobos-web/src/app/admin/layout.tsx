/**
 * Admin section layout with server-side authorization guard.
 *
 * All /admin/* routes are protected. Non-admins are redirected to forbidden page.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/analytics/admin';

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

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-xl font-semibold text-text">Founder Analytics</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Private dashboard • Admin access only
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

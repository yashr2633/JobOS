/**
 * Admin authorization for founder analytics.
 *
 * SERVER ONLY. Uses service role to check admin_users allowlist.
 * Never trust client-side claims or metadata.
 */

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Check if a user is an admin/founder.
 *
 * Uses service role client to query admin_users table, which has no
 * client-accessible policies. This is the security authority - user_metadata
 * or client claims are NOT checked.
 *
 * @param userId - UUID from auth.users
 * @returns true if user exists in admin_users allowlist
 */
export async function isAdmin(userId: string): Promise<boolean> {
  if (!userId || typeof userId !== 'string') {
    return false;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    return !error && data !== null;
  } catch (error) {
    // Log server errors but default to deny
    console.error('[analytics/admin] Error checking admin status:', error);
    return false;
  }
}

/**
 * Throw 403 if user is not an admin.
 *
 * Convenience wrapper for API routes.
 */
export async function requireAdmin(userId: string | undefined): Promise<void> {
  if (!userId) {
    throw new AdminAuthError('No user ID provided', 401);
  }

  if (!(await isAdmin(userId))) {
    throw new AdminAuthError('Forbidden: Admin access required', 403);
  }
}

/**
 * Admin authentication error.
 */
export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 403
  ) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

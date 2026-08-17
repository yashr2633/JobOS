/**
 * Gmail connection data access.
 *
 * Follows the conventions in `applications.ts` / `resumes.ts`: the Supabase
 * client is passed in, every write is constrained by both row id and user_id,
 * and RLS backs it as a second layer.
 *
 * Tokens live only in this table and are only ever read by server code. No
 * function here is safe to call from a client component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Raised when a Gmail identity may not be bound to this JobTrackOS account. */
export class GmailIdentityMismatchError extends Error {
  constructor(message = "This Gmail account cannot be linked to this JobTrackOS account.") {
    super(message);
    this.name = "GmailIdentityMismatchError";
  }
}

interface GmailConnectionRow {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  token_type: string;
  google_sub: string;
  scopes: string[];
  /**
   * Sprint 9: the mailbox address this connection reads.
   *
   * Not a credential — it is what the integrations page shows so the user can
   * confirm the right inbox is connected. Nullable because capture is
   * non-fatal and pre-Sprint-9 connections have no address until reconnect.
   */
  gmail_address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  /** Sprint 8: incremental-sync anchor. Null before the first full sync. */
  history_id: string | null;
  last_full_sync_at: string | null;
}

/**
 * Connection as the rest of the app sees it.
 *
 * Deliberately contains no token fields: nothing outside this module needs
 * them, and omitting them means a connection object can never be serialized
 * into a client component payload with secrets attached.
 */
export interface GmailConnection {
  id: string;
  userId: string;
  googleSub: string;
  expiresAt: string;
  scopes: string[];
  /** Mailbox address of the connected account. Null when it was never captured. */
  emailAddress: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
}

/**
 * Trim a captured mailbox address, collapsing blank values to null.
 *
 * Gmail's profile endpoint returns `emailAddress` as an optional field, so an
 * empty string is a real possibility and must not be stored as an address.
 */
function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapConnection(row: GmailConnectionRow): GmailConnection {
  return {
    id: row.id,
    userId: row.user_id,
    googleSub: row.google_sub,
    expiresAt: row.expires_at,
    scopes: row.scopes ?? [],
    emailAddress: normalizeEmailAddress(row.gmail_address),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncAt: row.last_sync_at,
  };
}

/**
 * Resolve the acting user id.
 *
 * Callers that already hold the authenticated user pass it in, which avoids a
 * second `getUser()` round trip to Supabase on every request.
 */
async function resolveUserId(
  supabase: SupabaseClient,
  userId?: string
): Promise<string> {
  if (userId) return userId;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  return user.id;
}

/** Fetch this user's connection row regardless of active state. */
async function findRowForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<GmailConnectionRow | null> {
  // limit(1) rather than maybeSingle(): maybeSingle throws if more than one
  // row somehow exists, which would make the integration unrecoverable
  // through the UI.
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error fetching Gmail connection row:", error);
    throw error;
  }

  return (data?.[0] as GmailConnectionRow | undefined) ?? null;
}

export interface UpsertGmailConnectionInput {
  /** Pass the already-authenticated user id to skip a redundant getUser(). */
  userId?: string;
  accessToken: string;
  /** Google omits refresh_token on some re-consents; the stored one is kept. */
  refreshToken: string | null;
  expiresAt: string;
  googleSub: string;
  scopes?: string[];
  /**
   * Mailbox address captured from the Gmail profile endpoint.
   *
   * Omitted or null means "not captured on this attempt". For the same Google
   * identity the stored address is then kept, so a failed capture never erases
   * an address that was captured earlier.
   */
  emailAddress?: string | null;
}

/**
 * Create or refresh this user's Gmail connection.
 *
 * Reconnecting after a disconnect reactivates the existing row. Without the
 * explicit `is_active: true` here, a reconnect would update tokens on an
 * inactive row and `getGmailConnection` would keep reporting "not connected".
 */
export async function upsertGmailConnection(
  supabase: SupabaseClient,
  input: UpsertGmailConnectionInput
): Promise<GmailConnection> {
  const userId = await resolveUserId(supabase, input.userId);
  const existing = await findRowForUser(supabase, userId);

  const scopes =
    input.scopes && input.scopes.length > 0
      ? input.scopes
      : ["https://www.googleapis.com/auth/gmail.readonly"];

  const capturedAddress = normalizeEmailAddress(input.emailAddress);

  if (existing) {
    const isRebind = existing.google_sub !== input.googleSub;

    // Defence in depth: the callback already applies the binding rules. An
    // ACTIVE connection's identity is immutable, so a mismatch here is a bug
    // or a bypass attempt, not a user action.
    if (isRebind && existing.is_active) {
      throw new GmailIdentityMismatchError(
        "A different Google account is already linked to this JobTrackOS account. Disconnect it first."
      );
    }

    // refresh_token is NOT NULL, and on a rebind there is no prior token to
    // fall back on, so Google must have supplied one.
    if (isRebind && !input.refreshToken) {
      throw new Error(
        "Google did not return a refresh token. Remove JobTrackOS from your Google account permissions and try again."
      );
    }

    // Reusing the row left behind by a disconnect. A different Google identity
    // is permitted here precisely because the user explicitly disconnected.
    const { data, error } = await supabase
      .from("gmail_connections")
      .update({
        access_token: input.accessToken,
        // Keep the stored refresh token when Google does not return a new one.
        // On a rebind there is nothing worth keeping, so require a fresh one.
        refresh_token: isRebind
          ? input.refreshToken
          : input.refreshToken ?? existing.refresh_token,
        expires_at: input.expiresAt,
        google_sub: input.googleSub,
        scopes,
        // A rebind points at a different mailbox, so a stale address would be
        // actively misleading and is cleared even when capture failed. For the
        // same identity the previously captured address is kept.
        gmail_address: isRebind
          ? capturedAddress
          : capturedAddress ?? normalizeEmailAddress(existing.gmail_address),
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation: this Google identity is actively linked to
      // another JobTrackOS account.
      if ((error as { code?: string }).code === "23505") {
        throw new GmailIdentityMismatchError(
          "This Gmail account is already linked to a different JobTrackOS account."
        );
      }
      console.error("Error updating Gmail connection:", error);
      throw error;
    }

    return mapConnection(data as GmailConnectionRow);
  }

  // A first-time connection must carry a refresh token, otherwise the
  // integration cannot survive the first access-token expiry.
  if (!input.refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Remove JobTrackOS from your Google account permissions and try again."
    );
  }

  const { data, error } = await supabase
    .from("gmail_connections")
    .insert({
      user_id: userId,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      expires_at: input.expiresAt,
      google_sub: input.googleSub,
      scopes,
      gmail_address: capturedAddress,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation: this Google identity is linked elsewhere.
    if ((error as { code?: string }).code === "23505") {
      throw new GmailIdentityMismatchError(
        "This Gmail account is already linked to a different JobTrackOS account."
      );
    }
    console.error("Error creating Gmail connection:", error);
    throw error;
  }

  return mapConnection(data as GmailConnectionRow);
}

/**
 * The Google subject id pinned by this account's ACTIVE connection, else null.
 *
 * Only active rows pin the identity. A row left behind by an explicit
 * disconnect must not permanently prevent the user from linking a different
 * Google account, which is the documented behaviour: the identity is immutable
 * while connected, and rebindable only after a deliberate disconnect.
 */
export async function getGmailConnectionGoogleSub(
  supabase: SupabaseClient,
  userId?: string
): Promise<string | null> {
  const resolvedUserId = await resolveUserId(supabase, userId);
  const row = await findRowForUser(supabase, resolvedUserId);

  if (!row || !row.is_active) return null;
  return row.google_sub ?? null;
}

/** This user's active Gmail connection, or null when not connected. */
export async function getGmailConnection(
  supabase: SupabaseClient,
  userId?: string
): Promise<GmailConnection | null> {
  const resolvedUserId = await resolveUserId(supabase, userId);
  const row = await findRowForUser(supabase, resolvedUserId);

  if (!row || !row.is_active) return null;
  return mapConnection(row);
}

/**
 * Disconnect Gmail.
 *
 * Clears the stored tokens and marks the row inactive. Blanking the tokens
 * means a disconnect actually revokes JobTrackOS's stored access rather than
 * merely hiding it behind a flag.
 */
export async function disconnectGmail(
  supabase: SupabaseClient,
  userId?: string
): Promise<void> {
  const resolvedUserId = await resolveUserId(supabase, userId);

  const { error } = await supabase
    .from("gmail_connections")
    .update({
      is_active: false,
      access_token: "",
      refresh_token: "",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", resolvedUserId);

  if (error) {
    console.error("Error disconnecting Gmail:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Server-only token access
// ---------------------------------------------------------------------------
//
// Everything below reads or writes OAuth token columns. None of it may be
// imported from a client component. The public `GmailConnection` type above
// deliberately omits token fields so the ordinary read path cannot leak them
// into a serialized page payload.

export interface ServerGmailTokens {
  connectionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  googleSub: string | null;
  scopes: string[];
  /** Incremental-sync anchor. Null until a full sync has completed. */
  historyId: string | null;
  /** Null means "never fully synced", which forces the full-sync path. */
  lastFullSyncAt: string | null;
}

/**
 * The active connection's tokens, for server-side Gmail API calls only.
 *
 * Returns null when there is no active connection, or when a disconnect has
 * blanked the tokens — both mean "not usable", and the caller must treat them
 * identically to "not connected".
 */
export async function getGmailTokensForServer(
  supabase: SupabaseClient,
  userId?: string
): Promise<ServerGmailTokens | null> {
  const resolvedUserId = await resolveUserId(supabase, userId);
  const row = await findRowForUser(supabase, resolvedUserId);

  if (!row || !row.is_active) return null;
  if (!row.access_token || !row.refresh_token) return null;

  return {
    connectionId: row.id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    googleSub: row.google_sub ?? null,
    scopes: row.scopes ?? [],
    historyId: row.history_id ?? null,
    lastFullSyncAt: row.last_full_sync_at ?? null,
  };
}

/**
 * Advance the incremental-sync anchor after a scan completes.
 *
 * Called only on successful completion. Advancing it earlier — or on a partial
 * scan — would permanently skip every message between the old and new anchor,
 * because history.list would never be asked about them again.
 */
export async function saveGmailHistoryAnchor(
  supabase: SupabaseClient,
  userId: string,
  input: { historyId: string; markFullSync: boolean }
): Promise<void> {
  const patch: Record<string, string> = {
    history_id: input.historyId,
    updated_at: new Date().toISOString(),
  };

  if (input.markFullSync) {
    patch.last_full_sync_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("gmail_connections")
    .update(patch)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("Error saving Gmail history anchor:", error);
    throw error;
  }
}

/**
 * Clear the anchor so the next sync falls back to a full scan.
 *
 * Used when Gmail reports the stored anchor is outside its retention window.
 */
export async function clearGmailHistoryAnchor(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("gmail_connections")
    .update({ history_id: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("Error clearing Gmail history anchor:", error);
    throw error;
  }
}

/**
 * Persist a refreshed access token.
 *
 * A null `refreshToken` means Google did not issue a new one, which is the
 * normal case on refresh. The stored value must then be left untouched —
 * overwriting it with null would permanently break the connection.
 */
export async function saveRefreshedGmailTokens(
  supabase: SupabaseClient,
  userId: string,
  input: {
    accessToken: string;
    expiresAt: string;
    refreshToken: string | null;
  }
): Promise<void> {
  const patch: Record<string, string> = {
    access_token: input.accessToken,
    expires_at: input.expiresAt,
    updated_at: new Date().toISOString(),
  };

  if (input.refreshToken) {
    patch.refresh_token = input.refreshToken;
  }

  const { error } = await supabase
    .from("gmail_connections")
    .update(patch)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("Error saving refreshed Gmail tokens:", error);
    throw error;
  }
}

/**
 * Mark the connection inactive without deleting its history.
 *
 * Used when Google reports the grant is gone. The row is retained so the
 * previously linked google_sub is still known, which is what allows a later
 * reconnect of the same identity to be recognised.
 */
export async function deactivateGmailConnection(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("gmail_connections")
    .update({
      is_active: false,
      access_token: "",
      refresh_token: "",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    console.error("Error deactivating Gmail connection:", error);
    throw error;
  }
}

/** Record that a sync completed, for the "Last synced" display. */
export async function touchGmailLastSync(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("gmail_connections")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    console.error("Error updating Gmail last_sync_at:", error);
    throw error;
  }
}

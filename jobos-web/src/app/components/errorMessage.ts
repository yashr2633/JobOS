/**
 * Turn a thrown value into something a person can read.
 *
 * Supabase rejects with a PostgrestError-shaped object whose `message` is raw
 * Postgres text ("duplicate key value violates unique constraint
 * applications_pkey"). That text names internal constraints and tables, so it
 * is never shown: a recognised SQLSTATE maps to a sentence, and anything else
 * falls back to the caller's own wording.
 *
 * Errors this app throws itself (`new Error("User must be logged in …")`) are
 * already written for a person, so their message is used as-is.
 */

/** SQLSTATE / PostgREST codes worth explaining specifically. */
const DATABASE_MESSAGES: Record<string, string> = {
  // unique_violation
  "23505": "That record already exists.",
  // foreign_key_violation
  "23503": "That change refers to something that no longer exists.",
  // not_null_violation
  "23502": "A required field was left empty.",
  // check_violation
  "23514": "One of the values isn't allowed here.",
  // insufficient_privilege / RLS
  "42501": "You don't have permission to do that.",
  // PostgREST: JWT expired or missing
  PGRST301: "Your session has expired. Sign in again to continue.",
  // PostgREST: no rows returned where one was required
  PGRST116: "That record could not be found — it may have been deleted.",
};

interface DatabaseErrorShape {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
}

/**
 * A PostgrestError carries `code`, `details` and `hint` alongside `message`.
 * Matching on that shape is what keeps raw SQL text out of the UI while still
 * letting our own `Error`s through.
 */
function asDatabaseError(value: unknown): DatabaseErrorShape | null {
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as DatabaseErrorShape;
  const hasDatabaseShape =
    "details" in candidate ||
    "hint" in candidate ||
    typeof candidate.code === "string";

  return hasDatabaseShape ? candidate : null;
}

export function toHumanMessage(error: unknown, fallback: string): string {
  const databaseError = asDatabaseError(error);

  if (databaseError !== null) {
    const code =
      typeof databaseError.code === "string" ? databaseError.code : null;
    // Raw Postgres text is deliberately dropped, not appended.
    return (code !== null ? DATABASE_MESSAGES[code] : undefined) ?? fallback;
  }

  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback;
}

/**
 * POST /api/gmail/sync/import
 *
 * Applies the user's review decisions. Nothing here happens automatically:
 * every application created or updated was explicitly approved in the UI.
 *
 * Per decision:
 *   import          -> create a new application, link its activity
 *   merge           -> link activity to an existing application the user chose
 *   ignore          -> mark the activity NOT_JOB_RELATED so it stops resurfacing
 *   reject          -> "not mine" on an automatically organized row: unlink its
 *                      activity and mark it NOT_JOB_RELATED
 *   resolve_unknown -> name the employer for an Unknown-bucket entry, creating
 *                      the application and linking the entry's activity
 *
 * `reject` and `resolve_unknown` are exception paths for work the Auto_Importer
 * either got wrong or refused to guess at. They are NOT an approval queue:
 * automatic organization never waits on them.
 *
 * Ownership is verified for every activity id and application id. Client-
 * supplied text is treated as untrusted data and bounded before it is stored.
 * Nothing here deletes Gmail evidence.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ignoreActivity,
  linkActivityToApplication,
  unlinkActivityFromApplication,
} from "@/lib/api/gmailActivity";
import { updateApplicationStatus } from "@/lib/api/applications";
import { isPortalDisplayName, sanitizeCompanyName } from "@/lib/gmail/heuristics";
import {
  shouldUpdateStatus,
  type ApplicationStatusValue,
  type InferredStatus,
} from "@/lib/gmail/statusInference";

/**
 * Runtime mirrors of the two status vocabularies defined in statusInference.ts.
 *
 * Declared as `Record<Union, true>` rather than a hand-written Set so the
 * compiler enforces that every member is listed. If either union changes, these
 * objects fail to compile instead of silently drifting out of sync with the
 * types — which is exactly how the previous `ALLOWED_STATUSES` Set (five
 * strings, no link to either union) allowed a 'Ghosted' value to slip toward a
 * parameter that forbids it.
 */

/**
 * Statuses a Gmail EVIDENCE email may imply.
 *
 * Excludes 'Ghosted' by construction: Ghosted is derived from the ABSENCE of
 * activity over time and can never be implied by a single message.
 */
const EVIDENCE_STATUSES: Record<InferredStatus, true> = {
  Applied: true,
  Interview: true,
  Offer: true,
  Rejected: true,
};

/** Every status the applications CHECK constraint permits. */
const APPLICATION_STATUSES: Record<ApplicationStatusValue, true> = {
  ...EVIDENCE_STATUSES,
  Ghosted: true,
};

/** Own-property lookup, so a prototype key can never satisfy a guard. */
function hasStatusKey(table: object, value: unknown): boolean {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(table, value)
  );
}

/**
 * Narrows to a status that may be applied FROM Gmail evidence.
 *
 * This is the guard `shouldUpdateStatus` needs, because its `nextStatus`
 * parameter is `InferredStatus` — the Ghosted-free union.
 */
function isEvidenceStatus(value: unknown): value is InferredStatus {
  return hasStatusKey(EVIDENCE_STATUSES, value);
}

/** Narrows to any status the applications table accepts, including Ghosted. */
function isApplicationStatus(value: unknown): value is ApplicationStatusValue {
  return hasStatusKey(APPLICATION_STATUSES, value);
}

const MAX_DECISIONS = 200;
const MAX_TEXT = 200;

/** Shown when a supplied employer name is really a job portal or platform. */
const PORTAL_NOT_EMPLOYER =
  "That looks like a job board or platform name, not an employer. " +
  "Enter the company you applied to.";

type Action = "import" | "merge" | "ignore" | "reject" | "resolve_unknown";

interface Decision {
  action: Action;
  activityIds: string[];
  applicationId?: string;
  /**
   * The employer. On `import` this is the proposal's company and may be absent;
   * on `resolve_unknown` it is the name the USER typed, and it is required.
   */
  company?: string;
  role?: string;
  location?: string;
  jobPortal?: string;
  appliedDate?: string;
  status?: string;
  /** Timestamp of the newest evidence in this proposal, for status monotonicity on merge. */
  lastActivityAt?: string;
}

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Bound and trim untrusted strings before they reach the database. */
function text(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed.slice(0, MAX_TEXT);
}

/** Accept only a plain YYYY-MM-DD date; otherwise fall back to today. */
function isoDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return value;
  }
  return new Date().toISOString().slice(0, 10);
}

/** The request-scoped Supabase client, typed without importing the SDK type. */
type RouteClient = Awaited<ReturnType<typeof createClient>>;

/** Every column the applications insert writes, already validated and bounded. */
interface ApplicationDraft {
  company: string;
  role: string;
  location: string;
  jobPortal: string;
  appliedDate: string;
  status: ApplicationStatusValue;
}

/**
 * Create an application and link its Gmail evidence in one logical step.
 *
 * Shared by `import` and `resolve_unknown` so the two cannot drift: the row
 * written, the fallbacks applied, and the link that follows are identical, and
 * only the way the employer name was obtained differs.
 *
 * Returns the new application id, or null when the insert failed — in which
 * case nothing was linked and the activity stays exactly as it was.
 */
async function createApplicationAndLink(
  supabase: RouteClient,
  userId: string,
  draft: ApplicationDraft,
  activityIds: string[]
): Promise<string | null> {
  // Fetch the gmail_message_id from the earliest activity row
  let gmailMessageId: string | null = null;
  if (activityIds.length > 0) {
    const { data: activityRows } = await supabase
      .from("gmail_activity")
      .select("gmail_message_id, email_date")
      .eq("user_id", userId)
      .in("id", activityIds)
      .order("email_date", { ascending: true })
      .limit(1);

    if (activityRows && activityRows.length > 0) {
      gmailMessageId = (activityRows[0] as { gmail_message_id: string }).gmail_message_id;
    }
  }

  const { data: application, error: insertError } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      company: draft.company,
      role: draft.role,
      location: draft.location,
      job_portal: draft.jobPortal,
      applied_date: draft.appliedDate,
      status: draft.status,
      gmail_message_id: gmailMessageId,
      // A Gmail-origin row, even though the user approved it in review: it exists
      // because Gmail found it, so "reset tracked Gmail applications" removes it.
      source: "gmail",
    })
    .select("id")
    .single();

  if (insertError || !application) {
    console.error(
      "[gmail/import] Application insert failed:",
      insertError?.message ?? "unknown"
    );
    return null;
  }

  const applicationId = (application as { id: string }).id;
  await linkActivityToApplication(supabase, userId, activityIds, applicationId);
  return applicationId;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return err("You must be logged in to import applications.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }

  const rawDecisions = (body as { decisions?: unknown }).decisions;
  if (!Array.isArray(rawDecisions) || rawDecisions.length === 0) {
    return err("No decisions were provided.", 400);
  }
  if (rawDecisions.length > MAX_DECISIONS) {
    return err("Too many decisions in one request.", 400);
  }

  const decisions = rawDecisions as Decision[];

  // ---- Verify ownership of every referenced activity row -----------------
  const allActivityIds = [
    ...new Set(
      decisions.flatMap((decision) =>
        Array.isArray(decision.activityIds) ? decision.activityIds : []
      )
    ),
  ].filter((id) => typeof id === "string" && id.length > 0);

  if (allActivityIds.length === 0) {
    return err("No activity was referenced.", 400);
  }

  const { data: ownedRows, error: ownedError } = await supabase
    .from("gmail_activity")
    .select("id")
    .eq("user_id", user.id)
    .in("id", allActivityIds);

  if (ownedError) {
    console.error("[gmail/import] Ownership check failed:", ownedError.message);
    return err("Could not verify the selected activity.", 500);
  }

  const owned = new Set((ownedRows ?? []).map((row) => (row as { id: string }).id));
  if (owned.size !== allActivityIds.length) {
    // A referenced row is missing or belongs to someone else. Refuse the whole
    // request rather than silently importing a subset.
    return err("Some selected activity could not be found.", 403);
  }

  let created = 0;
  let merged = 0;
  let ignored = 0;
  let rejected = 0;
  let resolved = 0;

  for (const decision of decisions) {
    const activityIds = (decision.activityIds ?? []).filter(
      (id) => typeof id === "string" && owned.has(id)
    );
    if (activityIds.length === 0) continue;

    if (decision.action === "ignore") {
      await ignoreActivity(supabase, user.id, activityIds);
      ignored += 1;
      continue;
    }

    if (decision.action === "merge") {
      const applicationId = decision.applicationId;
      if (typeof applicationId !== "string" || applicationId === "") {
        return err("A merge decision must name an application.", 400);
      }

      // The target application must belong to this user. Its current status
      // and when that status was last set are both needed to decide whether
      // the newly-merged evidence should move the status.
      const { data: target, error: targetError } = await supabase
        .from("applications")
        .select("id, status, updated_at")
        .eq("id", applicationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (targetError) {
        console.error("[gmail/import] Application lookup failed:", targetError.message);
        return err("Could not verify the target application.", 500);
      }
      if (!target) {
        return err("That application could not be found.", 403);
      }

      await linkActivityToApplication(supabase, user.id, activityIds, applicationId);

      // BUG FIX (Part 2): merging activity into an existing application
      // previously only linked the evidence — it never applied the resolved
      // status the review screen showed the user. An application could be
      // merged with rejection evidence attached and still show "Applied"
      // forever. shouldUpdateStatus() enforces the same monotonicity rule
      // used everywhere else: only strictly newer evidence may move the
      // status, so a stale confirmation email merged after the fact can never
      // downgrade a later Interview/Offer/Rejected.
      const currentStatus = isApplicationStatus(target.status)
        ? target.status
        : null;

      // A single guard that narrows straight to InferredStatus. The previous
      // two-step form (`nextStatus !== "Ghosted"` followed by a wider guard)
      // could not narrow: excluding a literal from the wide `string` type
      // leaves `string`, and the wider guard still admitted 'Ghosted'. Using
      // isEvidenceStatus enforces the runtime rule and the type in one place,
      // so a Ghosted value can never reach an evidence-only parameter.
      const nextStatus = decision.status;
      if (
        isEvidenceStatus(nextStatus) &&
        shouldUpdateStatus({
          currentStatus,
          currentStatusAt:
            typeof target.updated_at === "string" ? target.updated_at : null,
          nextStatus,
          nextStatusAt: decision.lastActivityAt ?? null,
        })
      ) {
        // The gate above is unchanged; only the WRITE moved. Status changes go
        // through the centralized lifecycle function, which validates the
        // transition, updates the row and appends exactly one history row with
        // source 'gmail' — atomically, and scoped to this user. A status that is
        // already what the evidence implies is a no-op there, so no history row
        // is ever created for a status that did not actually change.
        try {
          await updateApplicationStatus(supabase, {
            userId: user.id,
            applicationId,
            status: nextStatus,
            source: "gmail",
          });
        } catch (statusError) {
          console.error(
            "[gmail/import] Status update on merge failed:",
            statusError instanceof Error ? statusError.message : "unknown error"
          );
          // The activity link already succeeded; a failed or refused status bump
          // is not worth failing the whole request over.
        }
      }

      merged += 1;
      continue;
    }

    if (decision.action === "import") {
      // A NEW application may legitimately start at any of the five statuses,
      // including the derived 'Ghosted' that buildProposals computes from the
      // absence of replies. That derivation is our own deterministic logic
      // rather than a value read out of an email, so it is valid here — unlike
      // the merge path above, which applies per-message evidence.
      const status: ApplicationStatusValue = isApplicationStatus(
        decision.status
      )
        ? decision.status
        : "Applied";

      // BUG FIX (Part 1/3): this previously hardcoded job_portal to the
      // literal string "Gmail", discarding the actual source (LinkedIn,
      // Naukri, Indeed, Greenhouse, ...) that the pipeline already
      // determined. job_portal is SEPARATE from company — it records where
      // the application came from, and "Gmail" is not a job portal, it is
      // the discovery channel. Falling back to "Gmail" only when no more
      // specific portal name is available (e.g. a direct employer email).
      const applicationId = await createApplicationAndLink(
        supabase,
        user.id,
        {
          company: text(decision.company, "Unknown company"),
          role: text(decision.role, "Unknown role"),
          location: text(decision.location, "Not specified"),
          jobPortal: text(decision.jobPortal, "Gmail"),
          appliedDate: isoDate(decision.appliedDate),
          status,
        },
        activityIds
      );

      if (applicationId === null) {
        return err("Could not create one of the applications.", 500);
      }

      created += 1;
      continue;
    }

    // "Not mine" on a row the Auto_Importer organized. The application itself
    // is the user's to delete or keep; what this decision fixes is the WRONG
    // LINK, and it makes sure the same evidence cannot be re-organized on the
    // next scan. No evidence row is deleted.
    if (decision.action === "reject") {
      const applicationId = decision.applicationId;

      if (applicationId !== undefined) {
        if (typeof applicationId !== "string" || applicationId === "") {
          return err("A reject decision named an invalid application.", 400);
        }

        // Verified in the statement, not just by RLS: another user's
        // application must be unreachable through this id.
        const { data: target, error: targetError } = await supabase
          .from("applications")
          .select("id")
          .eq("id", applicationId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (targetError) {
          console.error(
            "[gmail/import] Application lookup failed on reject:",
            targetError.message
          );
          return err("Could not verify the target application.", 500);
        }
        if (!target) {
          return err("That application could not be found.", 403);
        }
      }

      // Both writes are idempotent: an already-detached row matches no update,
      // and an already-dismissed row is set to the category it already has, so
      // a repeated "not mine" is a no-op rather than an error.
      await unlinkActivityFromApplication(
        supabase,
        user.id,
        activityIds,
        typeof applicationId === "string" ? applicationId : undefined
      );
      await ignoreActivity(supabase, user.id, activityIds);

      rejected += 1;
      continue;
    }

    // The Unknown-bucket promotion path: the pipeline could not determine an
    // employer, so the user supplies one.
    if (decision.action === "resolve_unknown") {
      const supplied = decision.company;
      if (typeof supplied !== "string" || supplied.trim() === "") {
        return err("An employer name is required to resolve this entry.", 400);
      }

      // Untrusted text, bounded by the same convention as every other stored
      // string on this route.
      const bounded = supplied.trim().slice(0, MAX_TEXT);

      // A portal is never an employer, whoever typed it. Both guards are
      // applied: the display-name check the requirement names, and the
      // deterministic sanitizer every stored company value passes through.
      if (isPortalDisplayName(bounded)) {
        return err(PORTAL_NOT_EMPLOYER, 400);
      }

      const employer = sanitizeCompanyName(bounded);
      if (employer === null) {
        return err(PORTAL_NOT_EMPLOYER, 400);
      }

      const draft: ApplicationDraft = {
        company: employer,
        role: text(decision.role, "Unknown role"),
        location: text(decision.location, "Not specified"),
        jobPortal: text(decision.jobPortal, "Gmail"),
        appliedDate: isoDate(decision.appliedDate),
        status: isApplicationStatus(decision.status) ? decision.status : "Applied",
      };

      // Retry safety, step 1: a previous attempt may have already linked this
      // evidence. Link the rest to the same application instead of creating a
      // second one.
      const { data: linkedRows, error: linkedError } = await supabase
        .from("gmail_activity")
        .select("application_id")
        .eq("user_id", user.id)
        .in("id", activityIds)
        .not("application_id", "is", null);

      if (linkedError) {
        console.error(
          "[gmail/import] Link check failed on resolve_unknown:",
          linkedError.message
        );
        return err("Could not verify the selected activity.", 500);
      }

      const alreadyLinked = (linkedRows ?? [])
        .map((row) => (row as { application_id: string | null }).application_id)
        .find((id): id is string => typeof id === "string" && id !== "");

      if (alreadyLinked !== undefined) {
        const { data: target, error: targetError } = await supabase
          .from("applications")
          .select("id")
          .eq("id", alreadyLinked)
          .eq("user_id", user.id)
          .maybeSingle();

        if (targetError) {
          console.error(
            "[gmail/import] Application lookup failed on resolve_unknown:",
            targetError.message
          );
          return err("Could not verify the target application.", 500);
        }
        if (!target) {
          return err("That application could not be found.", 403);
        }

        await linkActivityToApplication(
          supabase,
          user.id,
          activityIds,
          alreadyLinked
        );
        resolved += 1;
        continue;
      }

      // Retry safety, step 2: a previous attempt may have created the
      // application and failed before linking. An identical owned application
      // is adopted rather than duplicated.
      const { data: existing, error: existingError } = await supabase
        .from("applications")
        .select("id")
        .eq("user_id", user.id)
        .eq("company", draft.company)
        .eq("role", draft.role)
        .eq("applied_date", draft.appliedDate)
        .limit(1)
        .maybeSingle();

      if (existingError) {
        console.error(
          "[gmail/import] Duplicate check failed on resolve_unknown:",
          existingError.message
        );
        return err("Could not create the application.", 500);
      }

      if (existing) {
        await linkActivityToApplication(
          supabase,
          user.id,
          activityIds,
          (existing as { id: string }).id
        );
        resolved += 1;
        continue;
      }

      const applicationId = await createApplicationAndLink(
        supabase,
        user.id,
        draft,
        activityIds
      );

      if (applicationId === null) {
        return err("Could not create the application.", 500);
      }

      resolved += 1;
      continue;
    }

    return err("Unknown decision action.", 400);
  }

  return NextResponse.json({ created, merged, ignored, rejected, resolved });
}

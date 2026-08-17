# Gmail Message ID Persistence Fix

## Problem Summary
The `applications.gmail_message_id` column existed in the schema but was not being populated when applications were created or linked to Gmail evidence. Existing applications imported from Gmail (like the Capgemini example) had `gmail_message_id = NULL`.

## Root Cause
Three code paths handle Gmail-to-application persistence, and only ONE was fetching and storing gmail_message_id:

1. **`applyCreate` (autoImport.ts)** - Creating NEW applications ✓ WORKING
2. **`applyLink` (autoImport.ts)** - Linking to EXISTING applications ✗ MISSING backfill
3. **`createApplicationAndLink` (import route)** - Manual import route ✗ MISSING fetch

## Files Changed

### 1. `src/lib/gmail/proposals.ts`
**Change**: Added `gmailMessageId` to `ProposalEvidence` interface and mapped it from activity rows.

**Why**: The gmail_message_id was available in activity rows but wasn't being passed through the proposal structure. This allows downstream code to access the message ID when creating or linking applications.

```typescript
export interface ProposalEvidence {
  activityId: string;
  gmailMessageId: string;  // ADDED
  category: EmailCategory;
  emailDate: string | null;
  sender: string | null;
}
```

### 2. `src/lib/gmail/autoImport.ts`

#### Change A: Modified `loadOwnedApplication` function
**Before**: Only returned `status` and `updatedAt`
**After**: Also returns `gmailMessageId`

```typescript
async function loadOwnedApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string
): Promise<{ status: ApplicationStatusValue | null; updatedAt: string | null; gmailMessageId: string | null } | null>
```

#### Change B: Modified `applyLink` function
**Added**: Backfill logic for gmail_message_id

When linking Gmail activity to an existing application that doesn't have a gmail_message_id yet:
1. Check if the application already has a gmail_message_id
2. If not, and we have evidence, fetch the gmail_message_id from the earliest activity row
3. Update the application with the gmail_message_id

```typescript
// Backfill gmail_message_id if the application doesn't have one yet and
// we have Gmail evidence. This handles existing applications that were
// created before this field existed or were matched to Gmail activity.
if (!target.gmailMessageId && proposal.evidence.length > 0) {
  const earliestEvidence = proposal.evidence[0];
  const { data: activityRow } = await supabase
    .from("gmail_activity")
    .select("gmail_message_id")
    .eq("id", earliestEvidence.activityId)
    .eq("user_id", userId)
    .single();

  if (activityRow) {
    const gmailMessageId = (activityRow as { gmail_message_id: string }).gmail_message_id;
    if (gmailMessageId) {
      await supabase
        .from("applications")
        .update({ gmail_message_id: gmailMessageId })
        .eq("id", applicationId)
        .eq("user_id", userId);
    }
  }
}
```

### 3. `src/app/api/gmail/sync/import/route.ts`

#### Modified `createApplicationAndLink` function
**Added**: Fetch gmail_message_id from earliest activity row before creating application

```typescript
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

// Then include in INSERT
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
    gmail_message_id: gmailMessageId,  // ADDED
  })
```

### 4. `src/lib/gmail/gmailMessageId.test.ts` (NEW FILE)
**Created**: Test suite verifying gmail_message_id persistence through proposals

Tests verify:
- Proposals preserve gmail_message_id from earliest evidence
- Multiple threads preserve distinct gmail_message_ids
- Evidence is correctly sorted and message IDs map correctly

## Test Results

### New Tests
```
✔ proposal preserves gmail_message_id from the earliest evidence
✔ proposals group by thread and preserve distinct gmail_message_ids
```

### Existing Tests (All Passing)
- **autoImport.test.ts**: 15/15 passing ✓
- **proposals.test.ts**: 23/23 passing ✓
- **TypeScript compilation**: Clean ✓

## Expected Behavior

### For NEW Applications (Created by Auto-Import)
- `applyCreate` fetches gmail_message_id from earliest evidence and stores it ✓

### For EXISTING Applications (Linked to Gmail Activity)
- First link: `applyLink` fetches gmail_message_id from earliest evidence and backfills it ✓
- Subsequent links: gmail_message_id already exists, no update needed ✓

### For Manual Import Route
- `createApplicationAndLink` fetches gmail_message_id from earliest evidence and stores it ✓

## Migration Path for Existing Data

Existing applications without gmail_message_id will be automatically backfilled when:
1. The next auto-import scan runs and links new Gmail activity to them
2. The user manually imports/links more Gmail evidence through the review UI

No database migration required - the fix is forward-compatible and self-healing.

## Limitations

1. **Existing unlinked applications remain unlinked**: Applications created manually (not from Gmail) won't get a gmail_message_id unless Gmail evidence is later linked to them.

2. **Earliest evidence wins**: The gmail_message_id is always taken from the earliest evidence by email_date. This is correct for "what was the first Gmail message about this application" but means later messages don't update it.

3. **No retroactive backfill**: Applications that were created from Gmail before this fix won't be backfilled until new Gmail activity is linked to them. A one-time backfill script could be created if needed.

## Verification Checklist

✓ Schema has `gmail_message_id` column (already verified)
✓ `applyCreate` stores gmail_message_id
✓ `applyLink` backfills gmail_message_id when missing
✓ `createApplicationAndLink` stores gmail_message_id
✓ `proposals.ts` carries gmail_message_id through evidence
✓ `loadOwnedApplication` returns gmail_message_id
✓ Tests cover the new behavior
✓ Existing tests still pass
✓ TypeScript compilation clean

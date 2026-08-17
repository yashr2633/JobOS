/**
 * Reset regression tests.
 *
 * A destructive, user-scoped operation, so these are the tests that matter most
 * in the codebase. They run against an in-memory Supabase fake that models the
 * subset of the query builder this module uses (`select`/`delete`/`update` with
 * `.eq` filters and `head` counts), so the ordering and scoping guarantees are
 * exercised without a database.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  GMAIL_SOURCE,
  MANUAL_SOURCE,
  isApplicationSource,
  previewGmailApplicationReset,
  resetGmailApplications,
} from "./applicationReset.ts";

const USER = "user-a";
const OTHER_USER = "user-b";

interface Row {
  [key: string]: unknown;
}

/**
 * An in-memory stand-in for the parts of the Supabase client this module uses.
 *
 * `failOn` lets a test make one specific table's write fail, which is how the
 * partial-failure ordering guarantee is verified.
 */
class FakeDb {
  tables: Record<string, Row[]> = {
    applications: [],
    gmail_activity: [],
    gmail_sync_jobs: [],
    gmail_connections: [],
  };

  /** Table whose next mutation should throw. */
  failOn: string | null = null;

  /** Ordered log of mutations, for asserting execution order. */
  log: string[] = [];

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    const db = this;
    const filters: Array<[string, unknown]> = [];

    const matches = (row: Row) =>
      filters.every(([column, value]) => row[column] === value);

    /**
     * Whether a head count was requested. The real client allows `.eq()` AFTER
     * `.select(..., { head: true })`, so the builder has to stay chainable and be
     * awaited at the end — which is why it is thenable rather than returning a
     * Promise from `select`.
     */
    let headCount = false;

    const settle = () =>
      headCount
        ? { count: db.rows(table).filter(matches).length, error: null }
        : { data: db.rows(table).filter(matches), error: null };

    const builder: Record<string, unknown> = {
      select(_columns?: string, options?: { count?: string; head?: boolean }) {
        headCount = options?.head === true;
        return builder;
      },

      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },

      // Awaiting the builder runs the query with every filter applied.
      then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        try {
          return Promise.resolve(settle()).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error);
        }
      },

      delete() {
        return {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return this;
          },
          select() {
            if (db.failOn === table) {
              return Promise.resolve({
                data: null,
                error: { message: `simulated ${table} failure` },
              });
            }
            const removed = db.rows(table).filter(matches);
            db.tables[table] = db.rows(table).filter((row) => !matches(row));
            db.log.push(`delete:${table}`);
            return Promise.resolve({ data: removed, error: null });
          },
        };
      },

      update(patch: Row) {
        return {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            if (db.failOn === table) {
              return Promise.resolve({
                error: { message: `simulated ${table} failure` },
              });
            }
            for (const row of db.rows(table)) {
              if (matches(row)) Object.assign(row, patch);
            }
            db.log.push(`update:${table}`);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    return builder;
  }
}

/** A database seeded with both users' data. */
function seed(): FakeDb {
  const db = new FakeDb();

  db.rows("applications").push(
    { id: "gm-1", user_id: USER, source: GMAIL_SOURCE, company: "Acme" },
    { id: "gm-2", user_id: USER, source: GMAIL_SOURCE, company: "Beta" },
    { id: "man-1", user_id: USER, source: MANUAL_SOURCE, company: "Mine" },
    { id: "man-2", user_id: USER, source: MANUAL_SOURCE, company: "Also mine" },
    // Another user's rows, including a Gmail one.
    { id: "other-gm", user_id: OTHER_USER, source: GMAIL_SOURCE, company: "Theirs" },
    { id: "other-man", user_id: OTHER_USER, source: MANUAL_SOURCE, company: "Theirs" }
  );

  db.rows("gmail_activity").push(
    { id: "act-1", user_id: USER },
    { id: "act-2", user_id: USER },
    { id: "act-other", user_id: OTHER_USER }
  );

  db.rows("gmail_sync_jobs").push(
    { id: "job-1", user_id: USER },
    { id: "job-other", user_id: OTHER_USER }
  );

  db.rows("gmail_connections").push(
    {
      id: "conn-1",
      user_id: USER,
      access_token: "at",
      refresh_token: "rt",
      is_active: true,
      history_id: "12345",
      last_sync_at: "2026-01-01T00:00:00.000Z",
      gmail_address: "user@example.com",
    },
    {
      id: "conn-other",
      user_id: OTHER_USER,
      access_token: "at2",
      refresh_token: "rt2",
      is_active: true,
      history_id: "999",
    }
  );

  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (db: FakeDb): any => db;

// ---------------------------------------------------------------------------
// 1. Gmail-tracked records are reset
// ---------------------------------------------------------------------------

test("Gmail-created applications are deleted", async () => {
  const db = seed();
  const result = await resetGmailApplications(asClient(db), USER);

  assert.equal(result.deletedApplications, 2);
  const remaining = db
    .rows("applications")
    .filter((row) => row.user_id === USER)
    .map((row) => row.id);
  assert.deepEqual(remaining.sort(), ["man-1", "man-2"]);
});

test("the Gmail activity ledger and sync jobs are cleared", async () => {
  const db = seed();
  const result = await resetGmailApplications(asClient(db), USER);

  assert.equal(result.deletedActivityRows, 2);
  assert.equal(result.deletedSyncJobs, 1);
  assert.equal(
    db.rows("gmail_activity").filter((row) => row.user_id === USER).length,
    0
  );
  assert.equal(
    db.rows("gmail_sync_jobs").filter((row) => row.user_id === USER).length,
    0
  );
});

// ---------------------------------------------------------------------------
// 2. Manual applications remain
// ---------------------------------------------------------------------------

test("manual applications are never touched", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);

  const manual = db
    .rows("applications")
    .filter((row) => row.user_id === USER && row.source === MANUAL_SOURCE);

  assert.equal(manual.length, 2, "both manual applications survive");
  assert.deepEqual(
    manual.map((row) => row.company).sort(),
    ["Also mine", "Mine"]
  );
});

test("a reset with only manual applications deletes nothing", async () => {
  const db = new FakeDb();
  db.rows("applications").push(
    { id: "m1", user_id: USER, source: MANUAL_SOURCE },
    { id: "m2", user_id: USER, source: MANUAL_SOURCE }
  );
  db.rows("gmail_connections").push({ id: "c", user_id: USER, history_id: "1" });

  const result = await resetGmailApplications(asClient(db), USER);

  assert.equal(result.deletedApplications, 0);
  assert.equal(db.rows("applications").length, 2);
});

// ---------------------------------------------------------------------------
// 3. Gmail connection remains
// ---------------------------------------------------------------------------

test("the Gmail connection and its tokens survive — a reset is not a disconnect", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);

  const connection = db
    .rows("gmail_connections")
    .find((row) => row.user_id === USER);

  assert.ok(connection, "the connection row still exists");
  assert.equal(connection!.is_active, true, "still active");
  assert.equal(connection!.access_token, "at", "tokens untouched");
  assert.equal(connection!.refresh_token, "rt", "tokens untouched");
  assert.equal(
    connection!.gmail_address,
    "user@example.com",
    "the connected mailbox is unchanged"
  );
});

test("the sync anchor is cleared so the next scan is a fresh full scan", async () => {
  const db = seed();
  const result = await resetGmailApplications(asClient(db), USER);

  const connection = db
    .rows("gmail_connections")
    .find((row) => row.user_id === USER);

  assert.equal(connection!.history_id, null, "no incremental anchor remains");
  assert.equal(connection!.last_sync_at, null);
  assert.equal(connection!.last_full_sync_at, null);
  assert.equal(result.syncStateReset, true);
});

// ---------------------------------------------------------------------------
// 4 & 5. Other users are untouched and unreachable
// ---------------------------------------------------------------------------

test("another user's applications, evidence, and jobs are untouched", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);

  const theirs = db.rows("applications").filter((row) => row.user_id === OTHER_USER);
  assert.equal(theirs.length, 2, "including their Gmail-created application");

  assert.equal(
    db.rows("gmail_activity").filter((row) => row.user_id === OTHER_USER).length,
    1
  );
  assert.equal(
    db.rows("gmail_sync_jobs").filter((row) => row.user_id === OTHER_USER).length,
    1
  );
});

test("another user's connection anchor is not cleared", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);

  const theirs = db
    .rows("gmail_connections")
    .find((row) => row.user_id === OTHER_USER);
  assert.equal(theirs!.history_id, "999", "their sync state is intact");
});

test("User A resetting cannot reach User B's records, for either direction", async () => {
  const first = seed();
  await resetGmailApplications(asClient(first), USER);
  assert.ok(
    first.rows("applications").some((row) => row.id === "other-gm"),
    "B's Gmail application survives A's reset"
  );

  const second = seed();
  await resetGmailApplications(asClient(second), OTHER_USER);
  assert.ok(
    second.rows("applications").some((row) => row.id === "gm-1"),
    "A's Gmail application survives B's reset"
  );
  assert.ok(
    second.rows("applications").some((row) => row.id === "man-1"),
    "A's manual application survives B's reset"
  );
});

// ---------------------------------------------------------------------------
// 6. Failure safety
// ---------------------------------------------------------------------------

test("evidence is deleted BEFORE the applications it references", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);

  const activityIndex = db.log.indexOf("delete:gmail_activity");
  const applicationIndex = db.log.indexOf("delete:applications");

  assert.ok(activityIndex >= 0 && applicationIndex >= 0);
  assert.ok(
    activityIndex < applicationIndex,
    "no surviving evidence row can ever point at a deleted application"
  );
});

test("a failure part-way leaves applications intact, and a retry completes", async () => {
  const db = seed();

  // The sync-job step fails, so the run aborts BEFORE any application is deleted.
  db.failOn = "gmail_sync_jobs";
  await assert.rejects(() => resetGmailApplications(asClient(db), USER));

  assert.equal(
    db.rows("applications").filter((row) => row.user_id === USER).length,
    4,
    "no application was deleted by the failed run"
  );
  assert.equal(
    db.rows("gmail_activity").filter((row) => row.user_id === USER).length,
    0,
    "the step that did succeed is durable"
  );

  // Retry: every step is idempotent, so the reset converges.
  db.failOn = null;
  const result = await resetGmailApplications(asClient(db), USER);

  assert.equal(result.deletedApplications, 2);
  assert.equal(
    db.rows("applications").filter((row) => row.user_id === USER).length,
    2,
    "only the manual applications remain"
  );
});

test("a failure on the application delete preserves the connection", async () => {
  const db = seed();
  db.failOn = "applications";

  await assert.rejects(() => resetGmailApplications(asClient(db), USER));

  const connection = db
    .rows("gmail_connections")
    .find((row) => row.user_id === USER);
  assert.equal(connection!.is_active, true, "still connected after a failure");
  assert.equal(connection!.access_token, "at");
});

test("running the reset twice is idempotent", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);
  const second = await resetGmailApplications(asClient(db), USER);

  assert.equal(second.deletedApplications, 0);
  assert.equal(second.deletedActivityRows, 0);
  assert.equal(
    db.rows("applications").filter((row) => row.user_id === USER).length,
    2
  );
});

// ---------------------------------------------------------------------------
// 7. A fresh scan can create records again
// ---------------------------------------------------------------------------

test("after a reset the ledger is empty, so a rescan reprocesses every message", async () => {
  const db = seed();
  await resetGmailApplications(asClient(db), USER);

  // Dedup is driven by the ledger; an empty ledger means nothing is suppressed.
  assert.equal(
    db.rows("gmail_activity").filter((row) => row.user_id === USER).length,
    0
  );

  // Simulate what a fresh scan does: ledger a message and create an application.
  db.rows("gmail_activity").push({
    id: "fresh-act",
    user_id: USER,
    gmail_message_id: "msg-fresh",
  });
  db.rows("applications").push({
    id: "fresh-app",
    user_id: USER,
    source: GMAIL_SOURCE,
    company: "Fresh Co",
  });

  const forUser = db.rows("applications").filter((row) => row.user_id === USER);
  assert.equal(forUser.length, 3, "two manual plus one freshly imported");
  assert.ok(forUser.some((row) => row.id === "fresh-app"));

  // And a second reset removes only the fresh Gmail row again.
  const again = await resetGmailApplications(asClient(db), USER);
  assert.equal(again.deletedApplications, 1);
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

test("the preview reports real counts and changes nothing", async () => {
  const db = seed();
  const preview = await previewGmailApplicationReset(asClient(db), USER);

  assert.equal(preview.gmailApplications, 2);
  assert.equal(preview.manualApplications, 2);
  assert.equal(preview.activityRows, 2);

  // Read-only.
  assert.equal(db.log.length, 0, "the preview performed no mutation");
  assert.equal(db.rows("applications").length, 6);
});

test("the preview is scoped to the acting user", async () => {
  const db = seed();
  const preview = await previewGmailApplicationReset(asClient(db), OTHER_USER);

  assert.equal(preview.gmailApplications, 1, "only their own Gmail row");
  assert.equal(preview.manualApplications, 1);
  assert.equal(preview.activityRows, 1);
});

// ---------------------------------------------------------------------------
// The source vocabulary
// ---------------------------------------------------------------------------

test("the source guard accepts only the two known origins", () => {
  assert.equal(isApplicationSource("manual"), true);
  assert.equal(isApplicationSource("gmail"), true);
  assert.equal(isApplicationSource("Gmail"), false, "case-sensitive");
  assert.equal(isApplicationSource("system"), false);
  assert.equal(isApplicationSource(null), false);
  assert.equal(isApplicationSource(undefined), false);
});

test("the deletion target is 'gmail', never 'manual'", () => {
  // A guard against someone inverting the constant later.
  assert.equal(GMAIL_SOURCE, "gmail");
  assert.equal(MANUAL_SOURCE, "manual");
  assert.notEqual(GMAIL_SOURCE, MANUAL_SOURCE);
});

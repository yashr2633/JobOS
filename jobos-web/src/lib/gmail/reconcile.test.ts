/**
 * Tests for reconciliation.
 *
 * Deterministic unit tests only — no property-based testing here.
 *
 * The runner is exercised against a small in-memory Supabase fake that RECORDS
 * the filters applied to every statement, so "every read and write is scoped to
 * the acting user" is asserted against what the code actually sent, not against
 * a mock that was told to agree.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  planReconciliation,
  runReconciliation,
  type ApplicationRecord,
  type ReconciliationEvidenceRow,
} from "./reconcile.ts";
import type { EmailCategory } from "./heuristics.ts";

// ---------------------------------------------------------------------------
// In-memory Supabase fake
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

type FilterKind = "eq" | "neq" | "is" | "in" | "notIs";

interface RecordedFilter {
  kind: FilterKind;
  column: string;
  value: unknown;
}

interface RecordedStatement {
  table: string;
  operation: "select" | "insert" | "update";
  filters: RecordedFilter[];
  /** True when an inserted row carried the owner column. */
  payloadHasUserId: boolean;
}

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
}

class FakeDatabase {
  tables: Record<string, Row[]> = {
    applications: [],
    gmail_activity: [],
  };

  statements: RecordedStatement[] = [];

  /** Application ids whose UPDATE should fail, simulating a partial failure. */
  failUpdatesFor = new Set<string>();

  sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  rows(table: string): Row[] {
    const existing = this.tables[table];
    if (!existing) throw new Error(`unknown table: ${table}`);
    return existing;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<FakeResult> {
  db: FakeDatabase;
  table: string;
  filters: RecordedFilter[] = [];
  mutation: "insert" | "update" | null = null;
  selectRequested = false;
  payload: Row[] = [];
  patch: Row = {};
  orderColumn: string | null = null;
  ascending = true;
  limitValue: number | null = null;
  rowMode: "many" | "single" | "maybe" = "many";

  constructor(db: FakeDatabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_columns?: string): this {
    this.selectRequested = true;
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.mutation = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row): this {
    this.mutation = "update";
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, value: values });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    assert.equal(operator, "is", "the fake only implements .not(col, 'is', ...)");
    this.filters.push({ kind: "notIs", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.ascending = options?.ascending ?? true;
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  returns<T>(): PromiseLike<{ data: T | null; error: { message: string } | null }> {
    return this as unknown as PromiseLike<{
      data: T | null;
      error: { message: string } | null;
    }>;
  }

  single(): this {
    this.rowMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.rowMode = "maybe";
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const actual = row[filter.column] ?? null;
      switch (filter.kind) {
        case "eq":
          return actual === filter.value;
        case "neq":
          return actual !== filter.value;
        case "is":
          return actual === filter.value;
        case "in":
          return (filter.value as unknown[]).includes(actual);
        case "notIs":
          return actual !== filter.value;
      }
    });
  }

  /** Ids named by an `eq("id", ...)` filter, used by the failure injection. */
  targetedIds(): string[] {
    return this.filters
      .filter((filter) => filter.kind === "eq" && filter.column === "id")
      .map((filter) => String(filter.value));
  }

  execute(): FakeResult {
    this.db.statements.push({
      table: this.table,
      operation: this.mutation ?? "select",
      filters: [...this.filters],
      payloadHasUserId:
        this.mutation === "insert" &&
        this.payload.every((row) => typeof row.user_id === "string"),
    });

    const table = this.db.rows(this.table);

    if (this.mutation === "insert") {
      const created = this.payload.map((row) => ({
        id: this.db.nextId(this.table === "applications" ? "app" : "act"),
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        ...row,
      }));
      table.push(...created);
      return this.shape(created);
    }

    const matched = table.filter((row) => this.matches(row));

    if (this.mutation === "update") {
      if (
        this.table === "applications" &&
        this.targetedIds().some((id) => this.db.failUpdatesFor.has(id))
      ) {
        return { data: null, error: { message: "injected update failure" } };
      }
      for (const row of matched) Object.assign(row, this.patch);
      return this.shape(matched);
    }

    const sorted = this.sort(matched.map((row) => ({ ...row })));
    const limited =
      this.limitValue === null ? sorted : sorted.slice(0, this.limitValue);

    return this.shape(limited);
  }

  sort(rows: Row[]): Row[] {
    const column = this.orderColumn;
    if (!column) return rows;

    return rows.sort((a, b) => {
      const left = a[column];
      const right = b[column];
      if (left === right) return 0;
      // Nulls sort last regardless of direction.
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      const order = String(left) < String(right) ? -1 : 1;
      return this.ascending ? order : -order;
    });
  }

  shape(rows: Row[]): FakeResult {
    if (!this.selectRequested && this.mutation !== null) {
      return { data: null, error: null };
    }
    if (this.rowMode === "single") {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "expected exactly one row" } };
    }
    if (this.rowMode === "maybe") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}

/** The runner only needs a `from`; the cast keeps the module's real signature. */
function client(db: FakeDatabase): Parameters<typeof runReconciliation>[0] {
  return { from: (table: string) => db.from(table) } as unknown as Parameters<
    typeof runReconciliation
  >[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "user-1";
const OTHER_USER = "user-2";

/** The five statuses the applications CHECK constraint permits. */
const FROZEN_STATUSES = new Set([
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
]);

interface ApplicationInput {
  id: string;
  company: string;
  role: string;
  jobPortal: string | null;
  status: string;
  updatedAt: string;
  userId?: string;
  createdAt?: string;
}

function application(input: ApplicationInput): Row {
  return {
    id: input.id,
    user_id: input.userId ?? USER,
    company: input.company,
    role: input.role,
    location: "Not specified",
    job_portal: input.jobPortal,
    applied_date: "2024-01-01",
    status: input.status,
    created_at: input.createdAt ?? input.updatedAt,
    updated_at: input.updatedAt,
  };
}

interface ActivityInput {
  id: string;
  applicationId: string | null;
  category: EmailCategory;
  userId?: string;
  company?: string | null;
  jobTitle?: string | null;
  senderDomain?: string | null;
  emailDate?: string | null;
}

function activity(input: ActivityInput): Row {
  return {
    id: input.id,
    user_id: input.userId ?? USER,
    gmail_message_id: `msg-${input.id}`,
    gmail_thread_id: `t-${input.id}`,
    application_id: input.applicationId,
    category: input.category,
    company: input.company ?? null,
    job_title: input.jobTitle ?? null,
    job_url: null,
    location: null,
    email_date: input.emailDate ?? null,
    sender: null,
    sender_domain: input.senderDomain ?? null,
    inferred_status: null,
    confidence: 0.95,
    evidence_strength: "strong",
    evidence_reason: "lifecycle_subject_match",
  };
}

/** Assert the whole run stayed inside the acting user's rows. */
function assertUserScoped(db: FakeDatabase, userId: string): void {
  assert.ok(db.statements.length > 0, "the run should have issued statements");

  for (const statement of db.statements) {
    const scoped =
      statement.filters.some(
        (filter) =>
          filter.kind === "eq" &&
          filter.column === "user_id" &&
          filter.value === userId
      ) || statement.payloadHasUserId;

    assert.ok(
      scoped,
      `${statement.operation} on ${statement.table} was not scoped to ${userId}`
    );
  }
}

/** Assert no statement wrote to the evidence ledger. */
function assertEvidenceUntouched(db: FakeDatabase): void {
  const writes = db.statements.filter(
    (statement) =>
      statement.table === "gmail_activity" && statement.operation !== "select"
  );
  assert.deepEqual(
    writes,
    [],
    "reconciliation must never write to gmail_activity"
  );
}

function findApplication(db: FakeDatabase, id: string): Row {
  const row = db.rows("applications").find((candidate) => candidate.id === id);
  assert.ok(row, `application ${id} should exist`);
  return row;
}

// ---------------------------------------------------------------------------
// 1. Normal reconciliation patches the placeholders
// ---------------------------------------------------------------------------

test("reconciliation replaces the portal, company, role, and status placeholders", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      senderDomain: "greenhouse.io",
      emailDate: "2024-01-06T09:00:00.000Z",
    }),
    activity({
      id: "act-2",
      applicationId: "app-1",
      category: "INTERVIEW_INVITATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      senderDomain: "greenhouse.io",
      emailDate: "2024-01-20T09:00:00.000Z",
    })
  );

  const result = await runReconciliation(client(db), USER);

  assert.deepEqual(result, { examined: 1, patched: 1, failed: 0 });

  const app = findApplication(db, "app-1");
  assert.equal(app.company, "Globex");
  assert.equal(app.role, "Backend Engineer");
  assert.equal(app.job_portal, "Greenhouse");
  assert.equal(app.status, "Interview");
  assert.ok(FROZEN_STATUSES.has(String(app.status)));

  assertUserScoped(db, USER);
  assertEvidenceUntouched(db);
});

// ---------------------------------------------------------------------------
// 2. An already-reconciled run is idempotent
// ---------------------------------------------------------------------------

test("a second run patches nothing because no placeholder still matches", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "OFFER",
      company: "Initech",
      jobTitle: "Engineer",
      senderDomain: "lever.co",
      emailDate: "2024-02-01T09:00:00.000Z",
    })
  );

  const first = await runReconciliation(client(db), USER);
  const second = await runReconciliation(client(db), USER);

  assert.deepEqual(first, { examined: 1, patched: 1, failed: 0 });
  assert.deepEqual(second, { examined: 1, patched: 0, failed: 0 });

  const app = findApplication(db, "app-1");
  assert.equal(app.company, "Initech");
  assert.equal(app.role, "Engineer");
  assert.equal(app.job_portal, "Lever");
  assert.equal(app.status, "Offer");

  // The plan itself is empty the second time, which is why the run is a no-op.
  const plan = planReconciliation({
    applications: [
      {
        id: "app-1",
        company: "Initech",
        role: "Engineer",
        jobPortal: "Lever",
        status: "Offer",
        statusUpdatedAt: "2024-02-02T00:00:00.000Z",
      },
    ],
    activityByApplication: new Map<string, ReconciliationEvidenceRow[]>([
      [
        "app-1",
        [
          {
            category: "OFFER",
            company: "Initech",
            job_title: "Engineer",
            sender_domain: "lever.co",
            email_date: "2024-02-01T09:00:00.000Z",
          },
        ],
      ],
    ]),
  });
  assert.deepEqual(plan, []);
});

// ---------------------------------------------------------------------------
// 3. No duplicate application and no duplicate activity link
// ---------------------------------------------------------------------------

test("reconciliation creates no application and no activity link", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "REJECTION",
      company: "Hooli",
      jobTitle: "Engineer",
      senderDomain: "workable.com",
      emailDate: "2024-03-01T09:00:00.000Z",
    })
  );

  await runReconciliation(client(db), USER);
  await runReconciliation(client(db), USER);

  assert.equal(db.rows("applications").length, 1);
  assert.equal(db.rows("gmail_activity").length, 1);
  assert.equal(db.rows("gmail_activity")[0].application_id, "app-1");

  assert.deepEqual(
    db.statements.filter((statement) => statement.operation === "insert"),
    [],
    "reconciliation must never insert a row"
  );
  assertEvidenceUntouched(db);
});

// ---------------------------------------------------------------------------
// 4. A cross-user application cannot be read or patched
// ---------------------------------------------------------------------------

test("another user's application is neither read nor patched", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-foreign",
      userId: OTHER_USER,
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    }),
    application({
      id: "app-1",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-foreign",
      userId: OTHER_USER,
      applicationId: "app-foreign",
      category: "OFFER",
      company: "Foreign Corp",
      jobTitle: "Staff Engineer",
      senderDomain: "lever.co",
      emailDate: "2024-02-01T09:00:00.000Z",
    }),
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      senderDomain: "greenhouse.io",
      emailDate: "2024-02-02T09:00:00.000Z",
    })
  );

  const result = await runReconciliation(client(db), USER);

  assert.equal(result.examined, 1, "only the acting user's row is examined");
  assert.equal(result.patched, 1);

  // Asserted from the recorded filters: every statement named the acting user.
  assertUserScoped(db, USER);

  // And nothing ever targeted the foreign row.
  const touchedForeign = db.statements.some((statement) =>
    statement.filters.some(
      (filter) => filter.column === "id" && filter.value === "app-foreign"
    )
  );
  assert.equal(touchedForeign, false, "the foreign id must never be targeted");

  const foreign = findApplication(db, "app-foreign");
  assert.equal(foreign.company, "Unknown company");
  assert.equal(foreign.role, "Unknown role");
  assert.equal(foreign.job_portal, "Gmail");
  assert.equal(foreign.status, "Applied");
});

// ---------------------------------------------------------------------------
// 5. An unresolved employer is left alone, never given a placeholder
// ---------------------------------------------------------------------------

test("an unresolved employer keeps its stored value and is never replaced by a portal", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    // Evidence names no employer and no role, and its sender is a job board.
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "APPLICATION_CONFIRMATION",
      company: null,
      jobTitle: null,
      senderDomain: "linkedin.com",
      emailDate: "2024-01-06T09:00:00.000Z",
    })
  );

  const result = await runReconciliation(client(db), USER);

  assert.equal(result.patched, 1, "only the portal could be resolved");

  const app = findApplication(db, "app-1");
  // The portal is recorded in its own column...
  assert.equal(app.job_portal, "LinkedIn");
  // ...and never lands in company, which keeps its stored value untouched.
  assert.equal(app.company, "Unknown company");
  assert.equal(app.role, "Unknown role");

  // A portal name offered as the employer is refused by the plan as well.
  const plan = planReconciliation({
    applications: [
      {
        id: "app-1",
        company: "Unknown company",
        role: "Unknown role",
        jobPortal: "LinkedIn",
        status: "Applied",
        statusUpdatedAt: "2024-01-07T00:00:00.000Z",
      },
    ],
    activityByApplication: new Map<string, ReconciliationEvidenceRow[]>([
      [
        "app-1",
        [
          {
            category: "APPLICATION_CONFIRMATION",
            company: "LinkedIn",
            job_title: null,
            sender_domain: "linkedin.com",
            email_date: "2024-01-06T09:00:00.000Z",
          },
        ],
      ],
    ]),
  });
  assert.deepEqual(plan, [], "a portal name is never written as the employer");
});

// ---------------------------------------------------------------------------
// 6. A partial failure isolates to one application; a retry succeeds
// ---------------------------------------------------------------------------

test("one failing application does not abort the run, and a retry succeeds", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-broken",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z",
    }),
    application({
      id: "app-ok",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
      createdAt: "2024-01-02T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-broken",
      category: "OFFER",
      company: "Initech",
      jobTitle: "Engineer",
      senderDomain: "lever.co",
      emailDate: "2024-02-01T09:00:00.000Z",
    }),
    activity({
      id: "act-2",
      applicationId: "app-ok",
      category: "INTERVIEW_INVITATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      senderDomain: "greenhouse.io",
      emailDate: "2024-02-02T09:00:00.000Z",
    })
  );

  db.failUpdatesFor.add("app-broken");
  const first = await runReconciliation(client(db), USER);

  assert.deepEqual(first, { examined: 2, patched: 1, failed: 1 });

  // The healthy application was still repaired.
  const ok = findApplication(db, "app-ok");
  assert.equal(ok.company, "Globex");
  assert.equal(ok.status, "Interview");

  // The failing one is untouched and still matches its placeholders.
  const broken = findApplication(db, "app-broken");
  assert.equal(broken.company, "Unknown company");
  assert.equal(broken.job_portal, "Gmail");
  assert.equal(broken.status, "Applied");

  // Retry: the failure is gone, the plan is recomputed, and it patches.
  db.failUpdatesFor.clear();
  const second = await runReconciliation(client(db), USER);

  assert.deepEqual(second, { examined: 2, patched: 1, failed: 0 });
  const repaired = findApplication(db, "app-broken");
  assert.equal(repaired.company, "Initech");
  assert.equal(repaired.role, "Engineer");
  assert.equal(repaired.job_portal, "Lever");
  assert.equal(repaired.status, "Offer");

  assertEvidenceUntouched(db);
});

// ---------------------------------------------------------------------------
// 7. Evidence is preserved
// ---------------------------------------------------------------------------

test("no evidence row is deleted or unlinked by a run", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Unknown company",
      role: "Unknown role",
      jobPortal: "Gmail",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      senderDomain: "greenhouse.io",
      emailDate: "2024-01-06T09:00:00.000Z",
    }),
    activity({
      id: "act-2",
      applicationId: "app-1",
      category: "REJECTION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      senderDomain: "greenhouse.io",
      emailDate: "2024-01-25T09:00:00.000Z",
    })
  );

  const before = db.rows("gmail_activity").map((row) => ({ ...row }));
  await runReconciliation(client(db), USER);

  assert.deepEqual(db.rows("gmail_activity"), before);
  assertEvidenceUntouched(db);
});

// ---------------------------------------------------------------------------
// 8. Status correctness
// ---------------------------------------------------------------------------

test("a status move is gated by shouldUpdateStatus and never regresses", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Acme",
      role: "Engineer",
      jobPortal: "Referral",
      status: "Offer",
      updatedAt: "2024-06-01T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    // Older than the stored status timestamp, so it must not apply.
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Acme",
      jobTitle: "Engineer",
      senderDomain: "acme.com",
      emailDate: "2024-01-10T09:00:00.000Z",
    })
  );

  const result = await runReconciliation(client(db), USER);

  assert.equal(result.patched, 0);
  assert.equal(findApplication(db, "app-1").status, "Offer");
});

test("undated evidence moves no status", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Acme",
      role: "Engineer",
      jobPortal: "Referral",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-1",
      category: "REJECTION",
      company: "Acme",
      jobTitle: "Engineer",
      senderDomain: "acme.com",
      emailDate: null,
    })
  );

  const result = await runReconciliation(client(db), USER);

  assert.equal(result.patched, 0);
  assert.equal(findApplication(db, "app-1").status, "Applied");
});

test("only the five frozen status values are ever planned", () => {
  const categories: EmailCategory[] = [
    "APPLICATION_CONFIRMATION",
    "APPLICATION_RECEIVED",
    "APPLICATION_UPDATE",
    "INTERVIEW_INVITATION",
    "INTERVIEW_UPDATE",
    "RECRUITER_CONTACT",
    "REJECTION",
    "OFFER",
    "WITHDRAWAL",
    "FOLLOW_UP",
    "OTHER_JOB_RELATED",
    "NOT_JOB_RELATED",
  ];

  for (const category of categories) {
    const applications: ApplicationRecord[] = [
      {
        id: "app-1",
        company: "Acme",
        role: "Engineer",
        jobPortal: "Referral",
        status: null,
        statusUpdatedAt: null,
      },
    ];

    const plan = planReconciliation({
      applications,
      activityByApplication: new Map<string, ReconciliationEvidenceRow[]>([
        [
          "app-1",
          [
            {
              category,
              company: "Acme",
              job_title: "Engineer",
              sender_domain: "acme.com",
              email_date: "2024-01-10T09:00:00.000Z",
            },
          ],
        ],
      ]),
    });

    for (const patch of plan) {
      if (patch.status !== undefined) {
        assert.ok(
          FROZEN_STATUSES.has(patch.status),
          `${category} produced the disallowed status ${patch.status}`
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 9. A manually-created application with real values is untouched
// ---------------------------------------------------------------------------

test("a manual application is left completely untouched", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    // No Gmail evidence at all: never even examined for a patch.
    application({
      id: "app-manual",
      company: "Acme",
      role: "Staff Engineer",
      jobPortal: "Referral",
      status: "Interview",
      updatedAt: "2024-01-05T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z",
    }),
    // Real values AND linked evidence that agrees with the stored status.
    application({
      id: "app-real",
      company: "Globex",
      role: "Backend Engineer",
      jobPortal: "LinkedIn",
      status: "Interview",
      updatedAt: "2024-02-01T00:00:00.000Z",
      createdAt: "2024-01-02T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      applicationId: "app-real",
      category: "INTERVIEW_INVITATION",
      company: "Different Name Ltd",
      jobTitle: "Something Else",
      senderDomain: "greenhouse.io",
      emailDate: "2024-01-25T09:00:00.000Z",
    })
  );

  const before = db.rows("applications").map((row) => ({ ...row }));
  const result = await runReconciliation(client(db), USER);

  assert.deepEqual(result, { examined: 2, patched: 0, failed: 0 });
  assert.deepEqual(db.rows("applications"), before);

  // No update statement was even attempted against either row.
  assert.deepEqual(
    db.statements.filter(
      (statement) =>
        statement.table === "applications" && statement.operation === "update"
    ),
    []
  );
  assertUserScoped(db, USER);
});

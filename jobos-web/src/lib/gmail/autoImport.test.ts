/**
 * Tests for the Auto_Importer.
 *
 * Deterministic unit tests only — no property-based testing here (tasks 8.2,
 * 8.4 and 8.5 own the properties).
 *
 * The runner is exercised against a small in-memory Supabase fake that RECORDS
 * the filters applied to every statement, so "every read and write is scoped to
 * the acting user" is asserted against what the code actually sent, not against
 * a mock that was told to agree.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { decideProposal, runAutoImport } from "./autoImport.ts";
import type { ApplicationProposal } from "./proposals.ts";
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
function client(db: FakeDatabase): Parameters<typeof runAutoImport>[0] {
  return { from: (table: string) => db.from(table) } as unknown as Parameters<
    typeof runAutoImport
  >[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "user-1";
const OTHER_USER = "user-2";

interface ActivityInput {
  id: string;
  category: EmailCategory;
  userId?: string;
  company?: string | null;
  jobTitle?: string | null;
  threadId?: string | null;
  emailDate?: string | null;
  strength?: "strong" | "weak" | null;
  applicationId?: string | null;
  senderDomain?: string | null;
}

function activity(input: ActivityInput): Row {
  return {
    id: input.id,
    user_id: input.userId ?? USER,
    gmail_message_id: `msg-${input.id}`,
    gmail_thread_id: input.threadId ?? null,
    application_id: input.applicationId ?? null,
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
    evidence_strength: input.strength ?? null,
    evidence_reason: input.strength === null ? null : "lifecycle_subject_match",
  };
}

function application(input: {
  id: string;
  company: string;
  role: string;
  appliedDate: string;
  status: string;
  updatedAt: string;
  userId?: string;
}): Row {
  return {
    id: input.id,
    user_id: input.userId ?? USER,
    company: input.company,
    role: input.role,
    location: "Not specified",
    job_portal: "Gmail",
    applied_date: input.appliedDate,
    status: input.status,
    created_at: input.updatedAt,
    updated_at: input.updatedAt,
  };
}

/** A proposal with strong evidence and no match — the create-path baseline. */
function proposal(overrides: Partial<ApplicationProposal> = {}): ApplicationProposal {
  return {
    key: "ct:acme|engineer",
    activityIds: ["act-1"],
    company: "Acme",
    jobTitle: "Engineer",
    jobPortal: null,
    jobUrl: null,
    location: null,
    appliedDate: "2024-01-10T00:00:00.000Z",
    lastActivityAt: "2024-01-10T00:00:00.000Z",
    status: "Applied",
    statusFromEvidence: true,
    confidence: 0.95,
    evidence: [],
    suggestedApplicationId: null,
    matchTier: "none",
    autoLink: false,
    evidenceStrength: "strong",
    hasStrongEvidence: true,
    isLifecycleEvent: true,
    ...overrides,
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

// ---------------------------------------------------------------------------
// 1-5. The decision table
// ---------------------------------------------------------------------------

test("strong evidence with no existing application decides create", () => {
  assert.deepEqual(decideProposal(proposal()), {
    action: "create",
    applicationId: null,
    reason: "strong_lifecycle_evidence",
  });
});

test("strong evidence matching an owned application decides link", () => {
  for (const tier of ["thread", "job_url", "company_title"]) {
    assert.deepEqual(
      decideProposal(
        proposal({ matchTier: tier, suggestedApplicationId: "app-1" }),
        { ownedApplicationIds: new Set(["app-1"]) }
      ),
      {
        action: "link",
        applicationId: "app-1",
        reason: "matched_existing_application",
      },
      `tier ${tier} should link`
    );
  }
});

test("a company-only match and weak evidence both decide hold_ambiguous", () => {
  assert.deepEqual(
    decideProposal(
      proposal({ matchTier: "company_only", suggestedApplicationId: "app-1" })
    ),
    {
      action: "hold_ambiguous",
      applicationId: null,
      reason: "match_company_only",
    }
  );

  assert.deepEqual(
    decideProposal(
      proposal({ evidenceStrength: "weak", hasStrongEvidence: false })
    ),
    {
      action: "hold_ambiguous",
      applicationId: null,
      reason: "no_strong_evidence",
    }
  );
});

test("STRONG evidence with an unresolved employer now creates, not holds", () => {
  // The FIX 1 change: strong lifecycle evidence must not be withheld for want of
  // an employer name. It creates, and `applyCreate` stores the reconcilable
  // placeholder. The decision only records that the employer was unresolved.
  assert.deepEqual(decideProposal(proposal({ company: null })), {
    action: "create",
    applicationId: null,
    reason: "strong_evidence_unresolved_employer",
  });

  // A portal name sanitizes to null, so it is treated as unresolved and created
  // the same way — the portal is never stored as the employer.
  assert.deepEqual(decideProposal(proposal({ company: "LinkedIn" })), {
    action: "create",
    applicationId: null,
    reason: "strong_evidence_unresolved_employer",
  });
});

test("a NON-strong proposal with no employer still holds, never creates", () => {
  // Weak evidence with no employer has nothing to act on unattended, so the
  // hold_unknown_employer path remains reachable and correct.
  assert.deepEqual(
    decideProposal(
      proposal({ company: null, evidenceStrength: "weak", hasStrongEvidence: false })
    ),
    {
      action: "hold_unknown_employer",
      applicationId: null,
      reason: "employer_unresolved",
    }
  );

  assert.deepEqual(
    decideProposal(
      proposal({ company: "LinkedIn", evidenceStrength: "weak", hasStrongEvidence: false })
    ),
    {
      action: "hold_unknown_employer",
      applicationId: null,
      reason: "employer_resolved_to_portal",
    }
  );
});

test("the unresolved-employer placeholder matches reconcile's match target", async () => {
  // The two must be the exact same string, or a created placeholder could never
  // be upgraded by reconciliation. Asserted against reconcile's source so they
  // cannot drift.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { UNRESOLVED_COMPANY } = await import("./autoImport.ts");
  const reconcileSource = readFileSync(
    join(process.cwd(), "src", "lib", "gmail", "reconcile.ts"),
    "utf8"
  );
  assert.equal(UNRESOLVED_COMPANY, "Unknown company");
  assert.ok(
    reconcileSource.includes('COMPANY_PLACEHOLDER = "Unknown company"'),
    "reconcile must treat the same string as its company match target"
  );
});

test("a weak (model-derived) classification can never decide create", () => {
  for (const strength of ["weak", null] as const) {
    for (const company of ["Acme", null]) {
      const decision = decideProposal(
        proposal({
          company,
          evidenceStrength: strength,
          hasStrongEvidence: false,
        })
      );
      assert.notEqual(
        decision.action,
        "create",
        `strength ${String(strength)} must not create`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

test("a strong proposal creates a user-owned application and links its evidence", async () => {
  const db = new FakeDatabase();
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      threadId: "t-1",
      emailDate: "2024-02-01T09:00:00.000Z",
      strength: "strong",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-02-05T00:00:00.000Z"),
  });

  assert.equal(result.created, 1);
  assert.equal(result.linked, 0);
  assert.equal(result.failed, 0);

  const apps = db.rows("applications");
  assert.equal(apps.length, 1);
  assert.equal(apps[0].user_id, USER);
  assert.equal(apps[0].company, "Globex");
  assert.equal(apps[0].role, "Backend Engineer");
  assert.equal(apps[0].status, "Applied");
  assert.equal(apps[0].applied_date, "2024-02-01");

  // Created and linked in the same logical step.
  assert.equal(db.rows("gmail_activity")[0].application_id, apps[0].id);
  assertUserScoped(db, USER);
});

test("evidence matching an owned application links and advances its status", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Acme",
      role: "Engineer",
      appliedDate: "2024-01-05",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "INTERVIEW_INVITATION",
      company: "Acme",
      jobTitle: "Engineer",
      threadId: "t-1",
      emailDate: "2024-01-20T09:00:00.000Z",
      strength: "strong",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-01-22T00:00:00.000Z"),
  });

  assert.equal(result.created, 0);
  assert.equal(result.linked, 1);
  assert.equal(result.updated, 1);
  assert.equal(db.rows("applications").length, 1);
  assert.equal(db.rows("applications")[0].status, "Interview");
  assert.equal(db.rows("gmail_activity")[0].application_id, "app-1");
  assertUserScoped(db, USER);
});

test("weak lifecycle evidence is held, never created", async () => {
  const db = new FakeDatabase();
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "OFFER",
      company: "Initech",
      jobTitle: "Engineer",
      threadId: "t-1",
      emailDate: "2024-01-10T09:00:00.000Z",
      strength: "weak",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-01-12T00:00:00.000Z"),
  });

  assert.equal(result.created, 0);
  assert.equal(result.heldAmbiguous, 1);
  assert.equal(db.rows("applications").length, 0);
  // Left untouched and reviewable.
  assert.equal(db.rows("gmail_activity")[0].application_id, null);
});

test("strong lifecycle evidence with no employer creates under the placeholder", async () => {
  // FIX 1: strong evidence that the user reached a lifecycle stage (here, a
  // rejection) is persisted even without an employer name, under the explicit
  // "Unknown company" placeholder reconcile.ts upgrades — not held for manual
  // approval. Its evidence is linked, so it leaves the unknown bucket.
  const db = new FakeDatabase();
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "REJECTION",
      company: null,
      threadId: "t-1",
      emailDate: "2024-01-10T09:00:00.000Z",
      strength: "strong",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-01-12T00:00:00.000Z"),
  });

  assert.equal(result.created, 1);
  assert.equal(result.heldUnknownEmployer, 0);

  const apps = db.rows("applications");
  assert.equal(apps.length, 1);
  // The explicit placeholder, never a fabricated or portal employer.
  assert.equal(apps[0].company, "Unknown company");
  // Evidence linked, so the row is no longer in the unknown bucket.
  assert.equal(db.rows("gmail_activity")[0].application_id, apps[0].id);
});

test("a second run over the same mailbox is idempotent", async () => {
  const db = new FakeDatabase();
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Globex",
      jobTitle: "Backend Engineer",
      threadId: "t-1",
      emailDate: "2024-02-01T09:00:00.000Z",
      strength: "strong",
    })
  );

  const now = Date.parse("2024-02-05T00:00:00.000Z");
  const first = await runAutoImport(client(db), USER, { now });
  const second = await runAutoImport(client(db), USER, { now });

  assert.equal(first.created, 1);
  // The primary mechanism: creation linked the evidence, and the fetch only
  // returns UNLINKED lifecycle rows, so the second run has nothing to examine.
  assert.deepEqual(second, {
    examined: 0,
    created: 0,
    linked: 0,
    updated: 0,
    heldAmbiguous: 0,
    heldUnknownEmployer: 0,
    failed: 0,
  });

  assert.equal(db.rows("applications").length, 1);
  const linked = db
    .rows("gmail_activity")
    .filter((row) => row.application_id !== null);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].application_id, db.rows("applications")[0].id);
});

test("another user's application can never be linked to", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-foreign",
      userId: OTHER_USER,
      company: "Acme",
      role: "Engineer",
      appliedDate: "2024-01-05",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "OFFER",
      company: "Acme",
      jobTitle: "Engineer",
      threadId: "t-1",
      emailDate: "2024-01-10T09:00:00.000Z",
      strength: "strong",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-01-12T00:00:00.000Z"),
  });

  // The foreign row is invisible to a user-scoped candidate read, so it cannot
  // match; a new application is created for the acting user instead.
  assert.equal(result.linked, 0);
  assert.equal(result.created, 1);

  const foreign = db
    .rows("applications")
    .find((row) => row.id === "app-foreign");
  assert.equal(foreign?.status, "Applied");
  assert.equal(
    db.rows("gmail_activity").some((row) => row.application_id === "app-foreign"),
    false
  );
  assertUserScoped(db, USER);

  // And the decision table refuses a match id outside the owned set even if one
  // ever reached it.
  assert.deepEqual(
    decideProposal(
      proposal({ matchTier: "thread", suggestedApplicationId: "app-foreign" }),
      { ownedApplicationIds: new Set(["app-1"]) }
    ),
    {
      action: "hold_ambiguous",
      applicationId: null,
      reason: "match_target_not_owned",
    }
  );
});

test("older evidence never regresses a stronger stored status", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Acme",
      role: "Engineer",
      appliedDate: "2024-01-05",
      status: "Offer",
      updatedAt: "2024-06-01T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      category: "APPLICATION_CONFIRMATION",
      company: "Acme",
      jobTitle: "Engineer",
      threadId: "t-1",
      emailDate: "2024-01-10T09:00:00.000Z",
      strength: "strong",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-06-02T00:00:00.000Z"),
  });

  assert.equal(result.linked, 1);
  assert.equal(result.updated, 0);
  assert.equal(db.rows("applications")[0].status, "Offer");
  assert.equal(db.rows("gmail_activity")[0].application_id, "app-1");
});

test("the summary counts every action taken", async () => {
  const db = new FakeDatabase();
  db.rows("applications").push(
    application({
      id: "app-1",
      company: "Acme",
      role: "Engineer",
      appliedDate: "2024-01-05",
      status: "Applied",
      updatedAt: "2024-01-05T00:00:00.000Z",
    })
  );
  db.rows("gmail_activity").push(
    // create
    activity({
      id: "act-1",
      category: "OFFER",
      company: "Globex",
      jobTitle: "Backend Engineer",
      threadId: "t-1",
      emailDate: "2024-01-10T09:00:00.000Z",
      strength: "strong",
    }),
    // link + status advance
    activity({
      id: "act-2",
      category: "INTERVIEW_INVITATION",
      company: "Acme",
      jobTitle: "Engineer",
      threadId: "t-2",
      emailDate: "2024-01-20T09:00:00.000Z",
      strength: "strong",
    }),
    // company matches, role does not -> ambiguous
    activity({
      id: "act-3",
      category: "APPLICATION_CONFIRMATION",
      company: "Acme",
      jobTitle: "Data Scientist",
      threadId: "t-3",
      emailDate: "2024-01-15T09:00:00.000Z",
      strength: "strong",
    }),
    // strong lifecycle, no employer -> now CREATES under the placeholder (FIX 1)
    activity({
      id: "act-4",
      category: "REJECTION",
      company: null,
      threadId: "t-4",
      emailDate: "2024-01-18T09:00:00.000Z",
      strength: "strong",
    })
  );

  const result = await runAutoImport(client(db), USER, {
    now: Date.parse("2024-01-25T00:00:00.000Z"),
  });

  assert.deepEqual(result, {
    examined: 4,
    // act-1 (Globex offer) and act-4 (rejection, unresolved employer) both create.
    created: 2,
    linked: 1,
    updated: 1,
    heldAmbiguous: 1,
    // No longer held: strong unresolved-employer evidence now creates.
    heldUnknownEmployer: 0,
    failed: 0,
  });

  // Nothing was deleted: every evidence row survives the run.
  assert.equal(db.rows("gmail_activity").length, 4);
  // Only the ambiguous act-3 stays unlinked; act-4 linked its evidence on create.
  assert.equal(
    db.rows("gmail_activity").filter((row) => row.application_id === null).length,
    1
  );
  assertUserScoped(db, USER);
});

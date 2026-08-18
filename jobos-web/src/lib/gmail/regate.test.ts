/**
 * Tests for the legacy re-gate.
 *
 * Deterministic only — no property-based testing here, and no `fast-check`.
 *
 * Two harnesses, both already used elsewhere in this suite:
 *  - the in-memory Supabase fake from `autoImport.test.ts` / `reconcile.test.ts`,
 *    which RECORDS the filters applied to every statement, so "read and written
 *    only inside the acting user's rows" and "never inserted" are asserted
 *    against what the code actually sent
 *  - the `stubFetch` pattern from `incremental.test.ts`, so `getMessageMetadata`
 *    talks to a scripted mailbox instead of Gmail
 */

import assert from "node:assert/strict";
import test from "node:test";

import { runLegacyRegate } from "./regate.ts";
import type { EmailCategory } from "./heuristics.ts";
import { __setAdminClientFactoryForTests } from "../supabase/admin.ts";

// ---------------------------------------------------------------------------
// In-memory Supabase fake (records applied filters)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

type FilterKind = "eq" | "neq" | "is" | "in" | "notIs" | "or";

interface RecordedFilter {
  kind: FilterKind;
  column: string;
  value: unknown;
}

interface RecordedStatement {
  table: string;
  operation: "select" | "insert" | "update";
  filters: RecordedFilter[];
  payloadHasUserId: boolean;
}

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

class FakeDatabase {
  tables: Record<string, Row[]> = {
    applications: [],
    gmail_activity: [],
    gmail_connections: [],
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

  /** Statements of one kind against one table, for insert/scope assertions. */
  operations(table: string, operation: "select" | "insert" | "update") {
    return this.statements.filter(
      (statement) =>
        statement.table === table && statement.operation === operation
    );
  }
}

class FakeQuery implements PromiseLike<FakeResult> {
  db: FakeDatabase;
  table: string;
  filters: RecordedFilter[] = [];
  mutation: "insert" | "update" | null = null;
  selectRequested = false;
  countRequested = false;
  headRequested = false;
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

  select(
    _columns?: string,
    options?: { count?: "exact"; head?: boolean }
  ): this {
    this.selectRequested = true;
    this.countRequested = options?.count !== undefined;
    this.headRequested = options?.head === true;
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

  /**
   * PostgREST `.or("a.is.null,b.eq.x")` — a disjunction over comma-separated
   * `column.operator.value` terms.
   *
   * Needed because the re-gate predicate is now "not strong", i.e.
   * `evidence_strength IS NULL OR evidence_strength = 'weak'`. Only the two
   * operators that predicate uses are implemented, and anything else asserts
   * rather than silently matching — a fake that quietly accepted an unsupported
   * operator would make a broken query look like a passing test.
   */
  or(expression: string): this {
    const terms = expression.split(",").map((term) => {
      const [column, operator, rawValue] = term.split(".");
      assert.ok(
        operator === "is" || operator === "eq",
        `the fake only implements .or() with is/eq, got '${operator}'`
      );
      return {
        column,
        value: operator === "is" && rawValue === "null" ? null : rawValue,
      };
    });

    this.filters.push({ kind: "or", column: terms[0].column, value: terms });
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
        case "or": {
          // Disjunction: the row matches if ANY term does, each term read off the
          // row's own column rather than the filter's nominal one.
          const terms = filter.value as { column: string; value: unknown }[];
          return terms.some((term) => (row[term.column] ?? null) === term.value);
        }
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

    if (this.countRequested) {
      return {
        data: this.headRequested ? null : matched,
        error: null,
        count: matched.length,
      };
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

function client(db: FakeDatabase): Parameters<typeof runLegacyRegate>[0] {
  const fake = { from: (table: string) => db.from(table) } as unknown as Parameters<
    typeof runLegacyRegate
  >[0];

  // The token read (getGmailTokensForServer) now goes through the service-role
  // client, not this passed-in client. Point that privileged client at the same
  // in-memory fake so the connection row this test seeds is what gets read.
  __setAdminClientFactoryForTests(() => fake as never);

  return fake;
}

// ---------------------------------------------------------------------------
// Gmail stub
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface StubMessage {
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
}

/** A scripted mailbox: message id -> metadata. Anything else answers 404. */
function stubMailbox(messages: Record<string, StubMessage>): {
  requested: string[];
} {
  const requested: string[] = [];

  globalThis.fetch = ((input: unknown) => {
    const url = String(input);
    const match = url.match(/\/messages\/([^?]+)/);
    const id = match ? decodeURIComponent(match[1]) : "";
    requested.push(id);

    const message = messages[id];
    if (!message) {
      return Promise.resolve(
        json({ error: { code: 404, message: "Not Found" } }, 404)
      );
    }

    return Promise.resolve(
      json({
        id,
        threadId: message.threadId,
        snippet: message.snippet,
        internalDate: String(Date.parse(message.date)),
        labelIds: ["INBOX"],
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: message.subject },
            { name: "From", value: message.from },
          ],
        },
      })
    );
  }) as typeof fetch;

  return { requested };
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "user-1";
const OTHER_USER = "user-2";

/** An active connection whose access token is valid, so no refresh is attempted. */
function connection(userId = USER): Row {
  return {
    id: `conn-${userId}`,
    user_id: userId,
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    token_type: "Bearer",
    google_sub: "sub-1",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    gmail_address: "user@example.com",
    is_active: true,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    last_sync_at: null,
    history_id: null,
    last_full_sync_at: null,
  };
}

interface ActivityInput {
  id: string;
  messageId: string;
  category: EmailCategory;
  userId?: string;
  threadId?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  emailDate?: string | null;
  strength?: "strong" | "weak" | null;
  applicationId?: string | null;
}

function activity(input: ActivityInput): Row {
  return {
    id: input.id,
    user_id: input.userId ?? USER,
    gmail_message_id: input.messageId,
    gmail_thread_id: input.threadId ?? null,
    application_id: input.applicationId ?? null,
    category: input.category,
    company: input.company ?? null,
    job_title: input.jobTitle ?? null,
    job_url: null,
    location: null,
    email_date: input.emailDate ?? "2024-02-01T09:00:00.000Z",
    sender: null,
    sender_domain: null,
    inferred_status: null,
    confidence: null,
    evidence_strength: input.strength ?? null,
    evidence_reason: null,
  };
}

/** Subject line the gate resolves to a strong APPLICATION_CONFIRMATION. */
const STRONG_MESSAGE: StubMessage = {
  threadId: "t-strong",
  subject: "Thank you for applying to Globex",
  from: "careers@globex.com",
  snippet: "Our team will review your application.",
  date: "2024-02-01T09:00:00.000Z",
};

/** ATS sender plus candidate language: genuinely ambiguous, so weak. */
const WEAK_MESSAGE: StubMessage = {
  threadId: "t-weak",
  subject: "Your application",
  from: "no-reply@greenhouse.io",
  snippet: "Application reference 4821.",
  date: "2024-02-02T09:00:00.000Z",
};

/** Assert every statement the run issued stayed inside one user's rows. */
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
// 1. Selection
// ---------------------------------------------------------------------------

test("every stuck row is re-gated: NULL strength and weak, both unlinked", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection());
  db.rows("gmail_activity").push(
    // The legacy row: NULL strength, no application.
    activity({ id: "act-legacy", messageId: "m-legacy", category: "OTHER_JOB_RELATED" }),
    // A row the CURRENT pipeline wrote as weak. This is the population that made
    // "Needs your input" never drain: weak can never auto-import, a scan can
    // never re-classify it (dedup removes it before any fetch), and while this
    // predicate matched only NULL it could never be re-gated either. It must be
    // re-gated now.
    activity({
      id: "act-weak",
      messageId: "m-weak",
      category: "OTHER_JOB_RELATED",
      strength: "weak",
    }),
    // Already gated.
    activity({
      id: "act-gated",
      messageId: "m-gated",
      category: "APPLICATION_CONFIRMATION",
      strength: "strong",
      company: "Acme",
    }),
    // Already organized.
    activity({
      id: "act-linked",
      messageId: "m-linked",
      category: "APPLICATION_CONFIRMATION",
      applicationId: "app-existing",
    }),
    // Explicitly dismissed by the user ("Ignore"). NULL strength, but must not
    // be resurrected.
    activity({ id: "act-ignored", messageId: "m-ignored", category: "NOT_JOB_RELATED" })
  );

  const mailbox = stubMailbox({
    "m-legacy": STRONG_MESSAGE,
    "m-weak": STRONG_MESSAGE,
    "m-gated": STRONG_MESSAGE,
    "m-linked": STRONG_MESSAGE,
    "m-ignored": STRONG_MESSAGE,
  });

  const result = await runLegacyRegate(client(db), USER, {
    now: Date.parse("2024-02-10T00:00:00.000Z"),
  });

  // Both stuck rows, and only those two.
  assert.equal(result.scannedLegacy, 2);
  assert.equal(result.reclassified, 2);
  assert.equal(result.remaining, 0);

  // Only the two stuck messages were ever fetched from Gmail. The strong, the
  // linked and the dismissed rows cost no Gmail call at all.
  assert.deepEqual(mailbox.requested.slice().sort(), ["m-legacy", "m-weak"]);

  // The predicate was expressed in the statement, not filtered in memory.
  const select = db
    .operations("gmail_activity", "select")
    .find((statement) =>
      statement.filters.some(
        (filter) => filter.kind === "or" && filter.column === "evidence_strength"
      )
    );
  assert.ok(select, "the stuck-row read should filter on evidence_strength");
  assert.deepEqual(
    select.filters.map((filter) => `${filter.kind}:${filter.column}`),
    [
      "eq:user_id",
      // NULL or weak: the whole not-strong population.
      "or:evidence_strength",
      "is:application_id",
      "notIs:gmail_message_id",
      "neq:category",
    ]
  );

  // The rows outside the predicate were untouched.
  const rows = db.rows("gmail_activity");
  assert.equal(rows.find((row) => row.id === "act-gated")?.evidence_reason, null);
  assert.equal(
    rows.find((row) => row.id === "act-linked")?.application_id,
    "app-existing"
  );
  assert.equal(
    rows.find((row) => row.id === "act-ignored")?.evidence_strength,
    null
  );
  assert.equal(
    rows.find((row) => row.id === "act-ignored")?.category,
    "NOT_JOB_RELATED"
  );
});

// ---------------------------------------------------------------------------
// 2 & 3. In-place update, identity preserved
// ---------------------------------------------------------------------------

test("legacy rows are updated in place: no ledger insert, message id unchanged", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection());
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      messageId: "m-1",
      threadId: "t-strong",
      category: "OTHER_JOB_RELATED",
    })
  );
  stubMailbox({ "m-1": STRONG_MESSAGE });

  const before = { ...db.rows("gmail_activity")[0] };

  const result = await runLegacyRegate(client(db), USER, {
    now: Date.parse("2024-02-10T00:00:00.000Z"),
  });

  assert.equal(result.reclassified, 1);

  // Nothing was inserted into the ledger, and nothing was removed from it.
  assert.equal(db.operations("gmail_activity", "insert").length, 0);
  assert.equal(db.rows("gmail_activity").length, 1);

  const after = db.rows("gmail_activity")[0];

  // The row is the same row: same primary key, same identity columns.
  assert.equal(after.id, before.id);
  assert.equal(after.gmail_message_id, "m-1");
  assert.equal(after.gmail_message_id, before.gmail_message_id);
  assert.equal(after.gmail_thread_id, before.gmail_thread_id);
  assert.equal(after.user_id, USER);

  // The verdict was written onto it.
  assert.equal(after.evidence_strength, "strong");
  assert.equal(after.evidence_reason, "lifecycle_subject_match");
  assert.equal(after.category, "APPLICATION_CONFIRMATION");
  assert.equal(after.company, "Globex");

  // Every update was filtered by row id AND user id.
  for (const update of db.operations("gmail_activity", "update")) {
    assert.ok(
      update.filters.some(
        (filter) => filter.column === "user_id" && filter.value === USER
      ),
      "an update was not scoped to the acting user"
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Strong evidence reaches the Auto_Importer
// ---------------------------------------------------------------------------

test("strong evidence reaches the Auto_Importer and can create an application", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection());
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      messageId: "m-1",
      threadId: "t-strong",
      category: "OTHER_JOB_RELATED",
    })
  );
  stubMailbox({ "m-1": STRONG_MESSAGE });

  const result = await runLegacyRegate(client(db), USER, {
    now: Date.parse("2024-02-10T00:00:00.000Z"),
  });

  assert.equal(result.reclassified, 1);
  assert.equal(result.applicationsCreated, 1);
  assert.equal(result.awaitingReview, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);

  const apps = db.rows("applications");
  assert.equal(apps.length, 1);
  assert.equal(apps[0].user_id, USER);
  assert.equal(apps[0].company, "Globex");
  assert.equal(apps[0].status, "Applied");

  // The legacy row was linked, not copied.
  assert.equal(db.rows("gmail_activity").length, 1);
  assert.equal(db.rows("gmail_activity")[0].application_id, apps[0].id);
  assertUserScoped(db, USER);
});

// ---------------------------------------------------------------------------
// 5 & 6. Ambiguous / weak evidence
// ---------------------------------------------------------------------------

test("ambiguous evidence ends as awaiting review, not an application", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection());
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      messageId: "m-1",
      threadId: "t-weak",
      category: "OTHER_JOB_RELATED",
    })
  );
  stubMailbox({ "m-1": WEAK_MESSAGE });

  const result = await runLegacyRegate(client(db), USER, {
    now: Date.parse("2024-02-10T00:00:00.000Z"),
  });

  assert.equal(result.reclassified, 1);
  assert.equal(result.awaitingReview, 1);
  assert.equal(result.applicationsCreated, 0);
  assert.equal(db.rows("applications").length, 0);

  const row = db.rows("gmail_activity")[0];
  assert.equal(row.evidence_strength, "weak");
  assert.equal(row.evidence_reason, "ats_sender_with_candidate_language");
  // No employer was invented for an ambiguous message.
  assert.equal(row.company, null);
  assert.equal(row.application_id, null);
});

test("weak evidence cannot create an application even with a known employer", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection());
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      messageId: "m-1",
      threadId: "t-weak",
      // A lifecycle category and an employer are already on the row, so the only
      // thing standing between it and an application is the gate's strength.
      category: "APPLICATION_CONFIRMATION",
      company: "Initech",
      jobTitle: "Engineer",
    })
  );
  stubMailbox({ "m-1": WEAK_MESSAGE });

  const result = await runLegacyRegate(client(db), USER, {
    now: Date.parse("2024-02-10T00:00:00.000Z"),
  });

  assert.equal(result.applicationsCreated, 0);
  assert.equal(result.applicationsUpdated, 0);
  assert.equal(result.awaitingReview, 1);
  assert.equal(db.rows("applications").length, 0);
  assert.equal(db.rows("gmail_activity")[0].evidence_strength, "weak");
  assert.equal(db.rows("gmail_activity")[0].application_id, null);
});

// ---------------------------------------------------------------------------
// 7. Cross-user isolation
// ---------------------------------------------------------------------------

test("another user's legacy rows are neither read nor written", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection(), connection(OTHER_USER));
  db.rows("gmail_activity").push(
    activity({
      id: "act-mine",
      messageId: "m-mine",
      threadId: "t-strong",
      category: "OTHER_JOB_RELATED",
    }),
    activity({
      id: "act-theirs",
      messageId: "m-theirs",
      threadId: "t-strong",
      category: "OTHER_JOB_RELATED",
      userId: OTHER_USER,
    })
  );

  const mailbox = stubMailbox({
    "m-mine": STRONG_MESSAGE,
    "m-theirs": STRONG_MESSAGE,
  });

  const result = await runLegacyRegate(client(db), USER, {
    now: Date.parse("2024-02-10T00:00:00.000Z"),
  });

  assert.equal(result.scannedLegacy, 1);
  assert.equal(result.reclassified, 1);

  // Never read: the other user's message was never fetched from Gmail.
  assert.deepEqual(mailbox.requested, ["m-mine"]);

  // Never written: the row is byte-for-byte the legacy row it started as.
  const theirs = db.rows("gmail_activity").find((row) => row.id === "act-theirs");
  assert.deepEqual(theirs, {
    ...activity({
      id: "act-theirs",
      messageId: "m-theirs",
      threadId: "t-strong",
      category: "OTHER_JOB_RELATED",
      userId: OTHER_USER,
    }),
  });

  // Proven from the recorded filters, not from the fake's own behaviour.
  assertUserScoped(db, USER);
});

// ---------------------------------------------------------------------------
// 8. Duplicate safety
// ---------------------------------------------------------------------------

test("running the re-gate twice creates no duplicate row and no duplicate application", async (t) => {
  t.after(restoreFetch);

  const db = new FakeDatabase();
  db.rows("gmail_connections").push(connection());
  db.rows("gmail_activity").push(
    activity({
      id: "act-1",
      messageId: "m-1",
      threadId: "t-strong",
      category: "OTHER_JOB_RELATED",
    })
  );
  stubMailbox({ "m-1": STRONG_MESSAGE });

  const now = Date.parse("2024-02-10T00:00:00.000Z");
  const first = await runLegacyRegate(client(db), USER, { now });
  const second = await runLegacyRegate(client(db), USER, { now });

  assert.equal(first.reclassified, 1);
  assert.equal(first.applicationsCreated, 1);

  // The row no longer matches the predicate, so the second pass has nothing to
  // do — it does not re-fetch, re-gate, or re-import anything.
  assert.deepEqual(second, {
    scannedLegacy: 0,
    reclassified: 0,
    applicationsCreated: 0,
    applicationsUpdated: 0,
    awaitingReview: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
  });

  assert.equal(db.rows("gmail_activity").length, 1);
  assert.equal(db.rows("applications").length, 1);
  assert.equal(db.operations("gmail_activity", "insert").length, 0);
});

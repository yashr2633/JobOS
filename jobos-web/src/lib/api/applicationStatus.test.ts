/**
 * Tests for the centralized application status write and the status history
 * reads.
 *
 * Deterministic unit tests against a small in-memory Supabase fake that RECORDS
 * every statement it is handed, following the approach in
 * `src/lib/gmail/autoImport.test.ts`. Recording is what lets "every statement is
 * scoped to the acting user" be asserted against what the code actually sent
 * rather than against a mock that was told to agree.
 *
 * The fake's `rpc("update_application_status", …)` models the Postgres function
 * in `supabase-schema-sprint10-application-lifecycle.sql`: ownership, no-op
 * detection, transition validation, the status update, and exactly one appended
 * history row. It reads the transition rules from `lifecycle.ts`, which is safe
 * precisely because `lifecycle.test.ts` asserts the SQL and `lifecycle.ts` agree
 * pair-for-pair.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchApplicationStatusHistory,
  fetchRecentStatusHistory,
  updateApplication,
  updateApplicationStatus,
} from "./applications.ts";
import {
  STATUS_CORRECTION_NOTE,
  classifyTransition,
  isApplicationStatus,
} from "../applications/lifecycle.ts";

// ---------------------------------------------------------------------------
// In-memory Supabase fake
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface RecordedFilter {
  column: string;
  value: unknown;
}

interface RecordedStatement {
  table: string;
  operation: "select" | "insert" | "update";
  filters: RecordedFilter[];
  patch: Row | null;
  payloadHasUserId: boolean;
}

interface FakeResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

class FakeDatabase {
  tables: Record<string, Row[]> = {
    applications: [],
    application_status_history: [],
  };

  statements: RecordedStatement[] = [];
  rpcCalls: { name: string; args: Row }[] = [];
  sequence = 0;

  /** The signed-in user this client speaks for. */
  authUserId: string | null;

  constructor(authUserId: string | null) {
    this.authUserId = authUserId;
  }

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

  history(): Row[] {
    return this.rows("application_status_history");
  }

  /**
   * The in-memory model of `public.update_application_status`.
   *
   * Mirrors the SQL step for step, including the two things the test suite cares
   * about most: a no-op writes nothing at all, and a successful change appends
   * exactly one row.
   */
  rpc(name: string, args: Row): FakeResult {
    this.rpcCalls.push({ name, args });

    if (name !== "update_application_status") {
      return { data: null, error: { message: `unknown function: ${name}` } };
    }

    const userId = this.authUserId;
    if (userId === null) {
      return {
        data: null,
        error: { message: "not authenticated", code: "42501" },
      };
    }

    const applicationId = String(args.p_application_id);
    const status = String(args.p_status);
    const source = String(args.p_source);
    const note = args.p_note === null ? null : String(args.p_note);
    const allowCorrection = args.p_allow_correction === true;

    if (!isApplicationStatus(status)) {
      return { data: null, error: { message: "bad status", code: "23514" } };
    }
    if (!["manual", "gmail", "system"].includes(source)) {
      return { data: null, error: { message: "bad source", code: "23514" } };
    }

    // Owner-scoped lookup, as the SQL does with `FOR UPDATE`.
    const application = this.rows("applications").find(
      (row) => row.id === applicationId && row.user_id === userId
    );
    if (!application) {
      return { data: null, error: { message: "not found", code: "42501" } };
    }

    const current = String(application.status);
    if (!isApplicationStatus(current)) {
      return { data: null, error: { message: "bad stored status" } };
    }

    // No-op: no update, no history row.
    if (current === status) return { data: current, error: null };

    if (
      !allowCorrection &&
      classifyTransition(current, status) === "requires_correction"
    ) {
      return {
        data: null,
        error: { message: "transition not allowed", code: "23514" },
      };
    }

    application.status = status;
    this.history().push({
      id: this.nextId("hist"),
      application_id: applicationId,
      user_id: userId,
      from_status: current,
      to_status: status,
      changed_at: new Date(1_700_000_000_000 + this.sequence * 1000).toISOString(),
      source,
      note,
    });

    return { data: status, error: null };
  }
}

class FakeQuery implements PromiseLike<FakeResult> {
  filters: RecordedFilter[] = [];
  mutation: "insert" | "update" | null = null;
  selectRequested = false;
  payload: Row[] = [];
  patch: Row = {};
  orderColumn: string | null = null;
  ascending = true;
  limitValue: number | null = null;
  rowMode: "many" | "single" | "maybe" = "many";

  db: FakeDatabase;
  table: string;

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
    this.filters.push({ column, value });
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
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  matches(row: Row): boolean {
    return this.filters.every(
      (filter) => (row[filter.column] ?? null) === filter.value
    );
  }

  execute(): FakeResult {
    this.db.statements.push({
      table: this.table,
      operation: this.mutation ?? "select",
      filters: [...this.filters],
      patch: this.mutation === "update" ? { ...this.patch } : null,
      payloadHasUserId:
        this.mutation === "insert" &&
        this.payload.every((row) => typeof row.user_id === "string"),
    });

    const table = this.db.rows(this.table);

    if (this.mutation === "insert") {
      const created = this.payload.map((row) => ({
        id: this.db.nextId(this.table),
        ...row,
      }));
      table.push(...created);
      return this.shape(created);
    }

    const matched = table.filter((row) => this.matches(row));

    if (this.mutation === "update") {
      for (const row of matched) Object.assign(row, this.patch);
      return this.shape(matched.map((row) => ({ ...row })));
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
      const left = String(a[column] ?? "");
      const right = String(b[column] ?? "");
      if (left === right) return 0;
      const order = left < right ? -1 : 1;
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

/** The data layer needs `from`, `rpc` and `auth.getUser`. */
function client(db: FakeDatabase): Parameters<typeof updateApplicationStatus>[0] {
  return {
    from: (table: string) => db.from(table),
    rpc: (name: string, args: Row) => Promise.resolve(db.rpc(name, args)),
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: db.authUserId === null ? null : { id: db.authUserId },
          },
          error: null,
        }),
    },
  } as unknown as Parameters<typeof updateApplicationStatus>[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "user-1";
const OTHER_USER = "user-2";

function application(overrides: Row = {}): Row {
  return {
    id: "app-1",
    user_id: USER,
    company: "Acme",
    role: "Engineer",
    location: "Remote",
    job_portal: "LinkedIn",
    applied_date: "2024-01-05",
    status: "Applied",
    salary: null,
    job_description: null,
    parsed_jd: null,
    parsed_jd_at: null,
    created_at: "2024-01-05T00:00:00.000Z",
    updated_at: "2024-01-05T00:00:00.000Z",
    ...overrides,
  };
}

function form(overrides: Record<string, string> = {}) {
  return {
    company: "Acme",
    role: "Engineer",
    location: "Remote",
    jobPortal: "LinkedIn",
    appliedDate: "2024-01-05",
    status: "Applied" as const,
    salary: "",
    jobDescription: "",
    ...overrides,
  };
}

/** Assert every recorded statement stayed inside the acting user's rows. */
function assertUserScoped(db: FakeDatabase, userId: string): void {
  assert.ok(db.statements.length > 0, "statements should have been issued");

  for (const statement of db.statements) {
    const scoped =
      statement.filters.some(
        (filter) => filter.column === "user_id" && filter.value === userId
      ) || statement.payloadHasUserId;

    assert.ok(
      scoped,
      `${statement.operation} on ${statement.table} was not scoped to ${userId}`
    );
  }
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to be refused");
}

// ---------------------------------------------------------------------------
// 1-3. The three valid transitions each record exactly one event
// ---------------------------------------------------------------------------

test("each valid transition updates the status and records one history row", async () => {
  const cases: [string, string][] = [
    ["Applied", "Interview"],
    ["Interview", "Offer"],
    ["Offer", "Rejected"],
  ];

  for (const [from, to] of cases) {
    const db = new FakeDatabase(USER);
    db.rows("applications").push(application({ status: from }));

    assert.ok(isApplicationStatus(to));
    const result = await updateApplicationStatus(client(db), {
      userId: USER,
      applicationId: "app-1",
      status: to,
      source: "manual",
    });

    assert.equal(result, to, `${from} -> ${to} should return the new status`);
    assert.equal(db.rows("applications")[0].status, to);

    // Exactly one row, carrying both ends of the move.
    assert.equal(db.history().length, 1, `${from} -> ${to} wrote wrong row count`);
    assert.equal(db.history()[0].from_status, from);
    assert.equal(db.history()[0].to_status, to);
    assert.equal(db.history()[0].user_id, USER);
    assert.equal(db.history()[0].source, "manual");
    assert.equal(db.history()[0].note, null);

    assertUserScoped(db, USER);
  }
});

// ---------------------------------------------------------------------------
// 4. A no-op records nothing
// ---------------------------------------------------------------------------

test("setting the status it already has writes no history row", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(application({ status: "Interview" }));

  const result = await updateApplicationStatus(client(db), {
    userId: USER,
    applicationId: "app-1",
    status: "Interview",
    source: "manual",
  });

  assert.equal(result, "Interview");
  assert.equal(db.history().length, 0);
  // The no-op is detected before the write, so the function is never called.
  assert.equal(db.rpcCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 5. An invalid transition is refused
// ---------------------------------------------------------------------------

test("a transition outside the forward table is refused and writes nothing", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(application({ status: "Rejected" }));

  const error = await rejects(() =>
    updateApplicationStatus(client(db), {
      userId: USER,
      applicationId: "app-1",
      status: "Interview",
      source: "manual",
    })
  );

  assert.ok(error instanceof Error);
  assert.match(error.message, /Rejected/);
  // A readable sentence, never database text.
  assert.equal(/ERRCODE|constraint|SELECT/i.test(error.message), false);

  assert.equal(db.rows("applications")[0].status, "Rejected");
  assert.equal(db.history().length, 0);
  assert.equal(db.rpcCalls.length, 0);
});

test("the correction path applies a refused change and records it as one", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(application({ status: "Rejected" }));

  const result = await updateApplicationStatus(client(db), {
    userId: USER,
    applicationId: "app-1",
    status: "Interview",
    source: "manual",
    note: STATUS_CORRECTION_NOTE,
    allowCorrection: true,
  });

  assert.equal(result, "Interview");
  assert.equal(db.history().length, 1);
  assert.equal(db.history()[0].from_status, "Rejected");
  assert.equal(db.history()[0].to_status, "Interview");
  assert.equal(db.history()[0].note, STATUS_CORRECTION_NOTE);
  // Threaded to the function as its own parameter, not as a widened rule.
  assert.equal(db.rpcCalls[0].args.p_allow_correction, true);
});

// ---------------------------------------------------------------------------
// 6. Each source is stored as given
// ---------------------------------------------------------------------------

test("all three sources are stored on the history row", async () => {
  for (const source of ["manual", "gmail", "system"] as const) {
    const db = new FakeDatabase(USER);
    db.rows("applications").push(application({ status: "Applied" }));

    await updateApplicationStatus(client(db), {
      userId: USER,
      applicationId: "app-1",
      status: "Interview",
      source,
    });

    assert.equal(db.history().length, 1);
    assert.equal(db.history()[0].source, source);
  }
});

// ---------------------------------------------------------------------------
// 7-8. Ownership
// ---------------------------------------------------------------------------

test("another user's application cannot be updated", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(
    application({ id: "app-foreign", user_id: OTHER_USER, status: "Applied" })
  );

  const error = await rejects(() =>
    updateApplicationStatus(client(db), {
      userId: USER,
      applicationId: "app-foreign",
      status: "Interview",
      source: "manual",
    })
  );

  assert.ok(error instanceof Error);
  assert.equal(db.rows("applications")[0].status, "Applied");
  assert.equal(db.history().length, 0);
  assertUserScoped(db, USER);
});

test("a caller cannot act as a different user", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(application({ status: "Applied" }));

  const error = await rejects(() =>
    updateApplicationStatus(client(db), {
      userId: OTHER_USER,
      applicationId: "app-1",
      status: "Interview",
      source: "manual",
    })
  );

  assert.ok(error instanceof Error);
  assert.equal(db.rows("applications")[0].status, "Applied");
  assert.equal(db.history().length, 0);
});

test("status history reads never cross users", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(
    application({ status: "Applied" }),
    application({ id: "app-foreign", user_id: OTHER_USER, status: "Applied" })
  );

  db.history().push(
    {
      id: "hist-mine",
      application_id: "app-1",
      user_id: USER,
      from_status: "Applied",
      to_status: "Interview",
      changed_at: "2024-03-01T10:00:00.000Z",
      source: "manual",
      note: null,
    },
    {
      id: "hist-theirs",
      application_id: "app-foreign",
      user_id: OTHER_USER,
      from_status: "Applied",
      to_status: "Offer",
      changed_at: "2024-03-02T10:00:00.000Z",
      source: "manual",
      note: null,
    }
  );

  const mine = await fetchApplicationStatusHistory(client(db), USER, "app-1");
  assert.deepEqual(
    mine.map((event) => event.id),
    ["hist-mine"]
  );

  // Even naming the other user's application returns nothing.
  const theirs = await fetchApplicationStatusHistory(
    client(db),
    USER,
    "app-foreign"
  );
  assert.deepEqual(theirs, []);

  const recent = await fetchRecentStatusHistory(client(db), USER, 10);
  assert.deepEqual(
    recent.map((event) => event.id),
    ["hist-mine"]
  );

  assertUserScoped(db, USER);
});

// ---------------------------------------------------------------------------
// 9. Legacy applications
// ---------------------------------------------------------------------------

test("a legacy application has no history and none is fabricated", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(
    application({ status: "Interview", applied_date: "2023-06-01" })
  );

  const history = await fetchApplicationStatusHistory(client(db), USER, "app-1");

  // No "Applied on 2023-06-01" event is manufactured from applied_date, and no
  // event is derived from the current status.
  assert.deepEqual(history, []);
  assert.equal(db.history().length, 0);
});

// ---------------------------------------------------------------------------
// 10-12. The form save path
// ---------------------------------------------------------------------------

test("the general update never writes status, and a status change records one event", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(application({ status: "Applied" }));

  const updated = await updateApplication(
    client(db),
    "app-1",
    form({ status: "Interview" })
  );

  assert.equal(updated.status, "Interview");
  assert.equal(db.rows("applications")[0].status, "Interview");

  const generalUpdate = db.statements.find(
    (statement) =>
      statement.table === "applications" && statement.operation === "update"
  );
  assert.ok(generalUpdate, "the form save should issue a general update");
  assert.equal(
    Object.prototype.hasOwnProperty.call(generalUpdate.patch ?? {}, "status"),
    false,
    "status must not travel in the general update"
  );

  assert.equal(db.history().length, 1);
  assert.equal(db.history()[0].source, "manual");
  assert.equal(db.history()[0].from_status, "Applied");
  assert.equal(db.history()[0].to_status, "Interview");
  assertUserScoped(db, USER);
});

test("a form save that does not change the status records no event", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(application({ status: "Interview" }));

  const updated = await updateApplication(
    client(db),
    "app-1",
    form({ status: "Interview", location: "Berlin" })
  );

  assert.equal(updated.status, "Interview");
  assert.equal(db.rows("applications")[0].location, "Berlin");
  assert.equal(db.history().length, 0);
  assert.equal(db.rpcCalls.length, 0);
});

test("a form save cannot make a refused status change, and saves nothing when refused", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(
    application({ status: "Rejected", location: "Remote" })
  );

  const error = await rejects(() =>
    updateApplication(
      client(db),
      "app-1",
      form({ status: "Applied", location: "Berlin" })
    )
  );

  assert.ok(error instanceof Error);
  // Refused before anything was written, so the rest of the form did not land.
  assert.equal(db.rows("applications")[0].status, "Rejected");
  assert.equal(db.rows("applications")[0].location, "Remote");
  assert.equal(db.history().length, 0);
});

test("editing the job description invalidates the cached parse", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(
    application({
      status: "Applied",
      job_description: "Old description",
      parsed_jd: { title: "Engineer" },
      parsed_jd_at: "2024-02-01T00:00:00.000Z",
    })
  );

  await updateApplication(
    client(db),
    "app-1",
    form({ status: "Applied", jobDescription: "A brand new description" })
  );

  const row = db.rows("applications")[0];
  assert.equal(row.job_description, "A brand new description");
  assert.equal(row.parsed_jd, null);
  assert.equal(row.parsed_jd_at, null);
});

test("saving the same job description leaves the cached parse alone", async () => {
  const db = new FakeDatabase(USER);
  db.rows("applications").push(
    application({
      status: "Applied",
      job_description: "Same description",
      parsed_jd: { title: "Engineer" },
      parsed_jd_at: "2024-02-01T00:00:00.000Z",
    })
  );

  await updateApplication(
    client(db),
    "app-1",
    // Whitespace-only difference: the stored text is normalized, so it is the
    // same description and the parse stays valid.
    form({ status: "Applied", jobDescription: "  Same description  " })
  );

  const row = db.rows("applications")[0];
  assert.equal(row.job_description, "Same description");
  assert.deepEqual(row.parsed_jd, { title: "Engineer" });
  assert.equal(row.parsed_jd_at, "2024-02-01T00:00:00.000Z");
});

/**
 * Structural security tests for the Gmail tracking feature.
 *
 * These assert properties of the SOURCE TREE that unit tests on individual
 * functions cannot: that no client component can reach Gmail tokens, and that
 * no code path persists an email body. They are cheap and catch the class of
 * regression that only shows up as a production credential leak.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");

/** Every .ts/.tsx file under src/, recursively. */
function sourceFiles(dir: string = SRC_ROOT, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** A file is a client component when it declares the "use client" directive. */
function isClientComponent(contents: string): boolean {
  return /^\s*(["'])use client\1/m.test(contents);
}

function relative(file: string): string {
  return file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Token isolation
// ---------------------------------------------------------------------------

/** Modules that read or write OAuth token columns. Server-only, always. */
const SERVER_ONLY_MODULES = [
  "lib/gmail/tokens",
  "lib/gmail/client",
  "lib/gmail/sync",
  "lib/api/gmail",
  "lib/api/gmailActivity",
];

test("no client component imports a Gmail server-only module", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const contents = read(file);
    if (!isClientComponent(contents)) continue;

    for (const moduleName of SERVER_ONLY_MODULES) {
      // Matches both alias and relative import specifiers.
      const pattern = new RegExp(
        `from\\s+["'][^"']*${moduleName.replace("/", "\\/")}["']`
      );
      if (pattern.test(contents)) {
        offenders.push(`${relative(file)} imports ${moduleName}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `server-only modules leaked into the client bundle:\n${offenders.join("\n")}`);
});

test("no client component references Google OAuth secrets", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const contents = read(file);
    if (!isClientComponent(contents)) continue;

    if (/GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_ID/.test(contents)) {
      offenders.push(relative(file));
    }
  }

  assert.deepEqual(offenders, []);
});

test("no client component references raw token fields", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const contents = read(file);
    if (!isClientComponent(contents)) continue;

    if (/\b(access_token|refresh_token|accessToken|refreshToken)\b/.test(contents)) {
      offenders.push(relative(file));
    }
  }

  assert.deepEqual(offenders, []);
});

test("OAuth secrets are never exposed under a NEXT_PUBLIC_ name", () => {
  for (const file of sourceFiles()) {
    const contents = read(file);
    assert.equal(
      /NEXT_PUBLIC_[A-Z_]*(GOOGLE|GMAIL|CLIENT_SECRET)/.test(contents),
      false,
      `${relative(file)} exposes a Google credential to the browser`
    );
  }
});

// ---------------------------------------------------------------------------
// Email body must never be persisted
// ---------------------------------------------------------------------------

test("the tracking migration defines no email body column", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase-schema-sprint7-gmail-tracking.sql"),
    "utf8"
  );

  for (const forbidden of ["body_text", "email_body", "raw_body", "snippet"]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`, "i").test(migration),
      false,
      `migration must not persist ${forbidden}`
    );
  }
});

test("the activity insert path never writes body text", () => {
  const dataLayer = read(join(SRC_ROOT, "lib", "api", "gmailActivity.ts"));

  // bodyText is transient in parse.ts and must not appear in any insert.
  assert.equal(/bodyText/.test(dataLayer), false);
  assert.equal(/body_text/.test(dataLayer), false);
  assert.equal(/snippet/.test(dataLayer), false);
});

test("the activity record type has no body field", () => {
  const dataLayer = read(join(SRC_ROOT, "lib", "api", "gmailActivity.ts"));
  const recordBlock = dataLayer.match(
    /export interface GmailActivityRecord \{[\s\S]*?\n\}/
  );

  assert.ok(recordBlock, "GmailActivityRecord interface should exist");
  assert.equal(/body/i.test(recordBlock[0]), false);
});

// ---------------------------------------------------------------------------
// RLS expectations
// ---------------------------------------------------------------------------

test("both tracking tables enable RLS with all four owner policies", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase-schema-sprint7-gmail-tracking.sql"),
    "utf8"
  );

  for (const table of ["gmail_sync_jobs", "gmail_activity"]) {
    assert.ok(
      new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`).test(
        migration
      ),
      `${table} must enable RLS`
    );

    for (const operation of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`ON public\\.${table} FOR ${operation}`).test(migration),
        `${table} needs a ${operation} policy`
      );
    }
  }

  // Ownership predicate, not a permissive true.
  assert.ok(migration.includes("auth.uid() = user_id"));
  assert.equal(/USING\s*\(\s*true\s*\)/i.test(migration), false);
});

test("idempotency is enforced by a unique message constraint", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase-schema-sprint7-gmail-tracking.sql"),
    "utf8"
  );

  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?gmail_activity\(user_id, gmail_message_id\)/.test(
      migration
    ),
    "gmail_activity must be unique per (user_id, gmail_message_id)"
  );
});

test("the migration does not alter the applications status constraint", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase-schema-sprint7-gmail-tracking.sql"),
    "utf8"
  );

  assert.equal(/ALTER TABLE public\.applications/i.test(migration), false);
  assert.equal(/DROP CONSTRAINT/i.test(migration), false);
});

// ---------------------------------------------------------------------------
// Prompt-injection posture
// ---------------------------------------------------------------------------

test("the classifier prompt fences untrusted email content", () => {
  const prompts = read(join(SRC_ROOT, "lib", "ai", "prompts.ts"));

  assert.ok(prompts.includes("BEGIN_EMAILS"));
  assert.ok(prompts.includes("END_EMAILS"));
  assert.ok(/untrusted/i.test(prompts));
  // The model must be told never to obey instructions found in the data.
  assert.ok(/never obey/i.test(prompts));
});

test("the Gmail message id is never sent to an AI provider", () => {
  const sync = read(join(SRC_ROOT, "lib", "gmail", "sync.ts"));

  // Correlation uses an opaque per-batch index, not the Gmail id.
  assert.ok(sync.includes("opaqueId"));
  assert.equal(/id:\s*email\.gmailMessageId/.test(sync), false);
});

// ===========================================================================
// SPRINT 9 — precision modules, the additive migration, and ownership
// ===========================================================================
//
// The sections below extend the same idea to the modules added by the Gmail
// application-precision work. Three classes of regression are covered that no
// unit test on a single function can see:
//
//   1. the Sprint 9 migration staying additive and re-runnable,
//   2. the new modules persisting no email text and adding no AI provider,
//   3. ownership — every statement and every API route scoped to the acting
//      user, and no placeholder employer written by the automatic path.

const SPRINT9_MIGRATION = join(
  process.cwd(),
  "supabase-schema-sprint9-gmail-precision.sql"
);

/**
 * File contents with newlines normalized, or null when the file has not landed
 * yet. Normalizing matters: the comment strippers below are line-oriented, and a
 * stray CR would silently defeat them on a Windows checkout.
 */
function readOptional(file: string): string | null {
  try {
    return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

/**
 * SQL with every comment removed.
 *
 * The migration's header describes what it deliberately does NOT do ("no
 * existing column is altered or dropped", "public.applications is not
 * touched"), and its verification block quotes `public.applications` inside a
 * `pg_constraint` query. Asserting over raw text would either false-fail on
 * that prose or be satisfied by it. Only executable SQL is asserted on.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

/**
 * TypeScript source with comments removed, for the same reason: several of
 * these modules document the placeholders and the email fields they refuse to
 * write, and that prose must not decide a security assertion either way.
 */
function stripTsComments(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    // A trailing comment only; a `//` followed by a quote is more likely a URL
    // or a string than a comment, and is left alone.
    .map((line) => line.replace(/\s+\/\/[^"'`]*$/, ""))
    .join("\n");
}

/**
 * The object literal passed to every `.insert()` / `.update()` / `.upsert()`
 * in a module — i.e. exactly the values that reach a column.
 *
 * This is what makes the placeholder and body-text assertions precise: a
 * string may appear in a module as a value to MATCH against without being a
 * value the module WRITES, and only the latter is a data leak.
 */
function writePayloads(source: string): string[] {
  const payloads: string[] = [];
  const pattern = /\.(?:insert|update|upsert)\(\s*\{/g;

  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    const open = source.indexOf("{", match.index);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          payloads.push(source.slice(open, i + 1));
          break;
        }
      }
    }
    match = pattern.exec(source);
  }

  return payloads;
}

/** Every Supabase statement in a module, as text from `.from(` to its `;`. */
function supabaseStatements(source: string): string[] {
  return stripTsComments(source)
    .split(".from(")
    .slice(1)
    .map((tail) => tail.split(";")[0]);
}

/** The four modules added by this feature. `reconcile.ts` lands with task 13. */
const PRECISION_MODULES = [
  "applicationEvidence.ts",
  "autoImport.ts",
  "pendingDecisions.ts",
  "reconcile.ts",
] as const;

function precisionModulePath(name: string): string {
  return join(SRC_ROOT, "lib", "gmail", name);
}

// ---------------------------------------------------------------------------
// Sprint 9 migration: additive and re-runnable
// ---------------------------------------------------------------------------

test("the Sprint 9 migration never touches the applications table", () => {
  const sql = readOptional(SPRINT9_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint9-gmail-precision.sql should exist");

  const executable = stripSqlComments(sql);

  assert.equal(
    /ALTER TABLE\s+public\.applications/i.test(executable),
    false,
    "the applications table and its status CHECK constraint are frozen"
  );
  assert.equal(/DROP CONSTRAINT/i.test(executable), false);
  assert.equal(/ALTER COLUMN/i.test(executable), false);
  assert.equal(/DROP COLUMN/i.test(executable), false);
  assert.equal(/DROP (?:INDEX|POLICY|TABLE|TRIGGER)/i.test(executable), false);
});

test("the Sprint 9 migration is re-runnable", () => {
  const sql = readOptional(SPRINT9_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint9-gmail-precision.sql should exist");

  const executable = stripSqlComments(sql);

  // Every added column is guarded.
  const addColumns = executable.match(/ADD COLUMN(?:\s+IF NOT EXISTS)?/gi) ?? [];
  assert.ok(addColumns.length > 0, "the migration should add columns");
  for (const clause of addColumns) {
    assert.match(clause, /IF NOT EXISTS/i);
  }

  // Every added index is guarded.
  const createIndexes = executable.match(/CREATE\s+INDEX(?:\s+IF NOT EXISTS)?/gi) ?? [];
  assert.ok(createIndexes.length > 0, "the migration should add the bucket index");
  for (const clause of createIndexes) {
    assert.match(clause, /IF NOT EXISTS/i);
  }

  // ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so it must sit behind an
  // explicit pg_constraint existence check.
  if (/ADD CONSTRAINT/i.test(executable)) {
    assert.match(executable, /IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/i);
    assert.match(executable, /gmail_activity_evidence_strength_check/);
  }
});

test("the Sprint 9 migration persists no email text", () => {
  const sql = readOptional(SPRINT9_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint9-gmail-precision.sql should exist");

  const executable = stripSqlComments(sql);

  for (const forbidden of ["body_text", "email_body", "raw_body", "snippet", "subject"]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`, "i").test(executable),
      false,
      `the migration must not add a ${forbidden} column`
    );
  }
});

// ---------------------------------------------------------------------------
// The new modules persist no email text and add no AI provider
// ---------------------------------------------------------------------------

test("no precision module writes body, snippet, or subject text", (t) => {
  for (const name of PRECISION_MODULES) {
    const source = readOptional(precisionModulePath(name));
    if (source === null) {
      t.diagnostic(`${name} has not landed yet — skipped`);
      continue;
    }

    const stripped = stripTsComments(source);

    // Values that reach a column, not values the module merely reasons about:
    // the gate reads subject + snippet to classify, and that is exactly why the
    // assertion is on the write payload rather than on a bare string search.
    for (const payload of writePayloads(stripped)) {
      for (const forbidden of ["body", "snippet", "subject"]) {
        assert.equal(
          new RegExp(`\\b${forbidden}\\b`, "i").test(payload),
          false,
          `${name} writes ${forbidden} in ${payload.slice(0, 80)}`
        );
      }
    }

    // Nor may a read ask for such a column.
    const selects = stripped.match(/\.select\(\s*"[^"]*"/g) ?? [];
    for (const select of selects) {
      assert.equal(
        /body|snippet|subject/i.test(select),
        false,
        `${name} selects email text in ${select}`
      );
    }
  }
});

test("no precision module introduces an AI provider", (t) => {
  for (const name of PRECISION_MODULES) {
    const source = readOptional(precisionModulePath(name));
    if (source === null) {
      t.diagnostic(`${name} has not landed yet — skipped`);
      continue;
    }

    const stripped = stripTsComments(source);

    // A second provider would bypass the audited gateway: its retry, failover,
    // prompt fencing and redaction rules all live in lib/ai.
    assert.equal(/_API_KEY/.test(stripped), false, `${name} reads a provider key`);
    assert.equal(
      /api\.anthropic\.com|api\.openai\.com|generativelanguage|api\.groq\.com|openrouter/i.test(
        stripped
      ),
      false,
      `${name} calls a provider endpoint directly`
    );
    assert.equal(
      /from\s+["'][^"']*\/ai\//.test(stripped),
      false,
      `${name} imports the AI layer; escalation belongs to sync.ts`
    );
    assert.equal(/\bfetch\(/.test(stripped), false, `${name} makes a network call`);
  }
});

test("the evidence gate and the pending-decisions view touch no database", () => {
  for (const name of ["applicationEvidence.ts", "pendingDecisions.ts"]) {
    const stripped = stripTsComments(read(precisionModulePath(name)));
    assert.equal(
      stripped.includes(".from("),
      false,
      `${name} must stay pure — persistence belongs to the data layer`
    );
  }
});

// ---------------------------------------------------------------------------
// Ownership — every statement scoped to the acting user
// ---------------------------------------------------------------------------

/** Data-layer helpers that must always be handed the acting user's id. */
const USER_SCOPED_HELPERS = [
  "fetchActivityForApplication",
  "fetchLifecycleActivityForAutoImport",
  "getThreadApplicationLinks",
  "linkActivityToApplication",
  "unlinkActivityFromApplication",
  "ignoreActivity",
] as const;

function assertUserScoped(name: string, source: string): void {
  const statements = supabaseStatements(source);
  assert.ok(statements.length > 0, `${name} should build Supabase queries`);

  for (const statement of statements) {
    // A read or an update filters on user_id; an insert carries it in the row.
    const scoped =
      statement.includes('.eq("user_id", userId)') ||
      statement.includes("user_id: userId");
    assert.ok(
      scoped,
      `${name} has a statement with no user scope: ${statement.slice(0, 90)}`
    );
  }

  const stripped = stripTsComments(source);
  for (const helper of USER_SCOPED_HELPERS) {
    const calls = stripped.match(new RegExp(`\\b${helper}\\(`, "g")) ?? [];
    const scoped =
      stripped.match(
        new RegExp(`\\b${helper}\\(\\s*supabase,\\s*(?:userId|user\\.id)`, "g")
      ) ?? [];
    assert.equal(
      scoped.length,
      calls.length,
      `${name} calls ${helper} without the acting user id`
    );
  }
}

test("every Supabase statement in autoImport.ts is user-scoped", () => {
  assertUserScoped("autoImport.ts", read(precisionModulePath("autoImport.ts")));
});

test("every Supabase statement in reconcile.ts is user-scoped", (t) => {
  const source = readOptional(precisionModulePath("reconcile.ts"));
  if (source === null) {
    t.diagnostic("reconcile.ts has not landed yet — skipped");
    return;
  }

  assertUserScoped("reconcile.ts", source);
});

test("a matched application id is re-verified as owned before it is written", () => {
  const stripped = stripTsComments(read(precisionModulePath("autoImport.ts")));

  // A cross-user application id must be unreachable: the ownership re-check
  // filters on BOTH the id and the owner.
  assert.match(
    stripped,
    /\.eq\("id", applicationId\)[\s\S]{0,120}\.eq\("user_id", userId\)/
  );

  // A thread link is a match hint, never ownership proof.
  assert.match(stripped, /ownedApplicationIds/);
  assert.match(stripped, /threadLinks\.delete\(threadId\)/);
  assert.match(stripped, /match_target_not_owned/);
});

// ---------------------------------------------------------------------------
// Route authorization
// ---------------------------------------------------------------------------

test("every Gmail API route authorizes before it touches data", () => {
  const routes = sourceFiles(join(SRC_ROOT, "app", "api", "gmail"));
  assert.ok(routes.length > 0, "the Gmail API routes should exist");

  for (const file of routes) {
    const stripped = stripTsComments(read(file));
    const name = relative(file);

    // Ordering is asserted inside the exported handler, which is the only entry
    // point. A module-level helper may legitimately be declared above it and
    // still run after the guard, so those are covered by the ownership
    // assertion below instead of by position.
    const handler = stripped.search(
      /export async function (?:GET|POST|PUT|PATCH|DELETE)\b/
    );
    assert.ok(handler >= 0, `${name} should export a route handler`);
    const body = stripped.slice(handler);

    const authIndex = body.indexOf("auth.getUser()");
    assert.ok(authIndex >= 0, `${name} must identify the caller`);

    // The unauthenticated exit: JSON 401 for fetch routes, a login redirect for
    // the browser-navigated OAuth callback.
    assert.match(body, /if \(authError \|\| !user\)/, `${name} needs an auth guard`);
    const rejection = body.search(/401|NextResponse\.redirect\(loginUrl\)/);
    assert.ok(
      rejection > authIndex,
      `${name} must refuse an anonymous caller after the identity check`
    );

    const firstStatement = body.indexOf(".from(");
    if (firstStatement >= 0) {
      assert.ok(
        authIndex < firstStatement,
        `${name} reads data before it knows who is asking`
      );
      assert.ok(
        rejection < firstStatement,
        `${name} must return 401 before its first data statement`
      );
    }

    // Every statement in the file — handler or helper — is owner-scoped, so a
    // helper declared above the guard cannot reach another user's rows.
    for (const statement of supabaseStatements(read(file))) {
      const scoped =
        statement.includes('.eq("user_id", user.id)') ||
        statement.includes('.eq("user_id", userId)') ||
        statement.includes("user_id: user.id") ||
        statement.includes("user_id: userId");
      assert.ok(
        scoped,
        `${name} has a statement with no user scope: ${statement.slice(0, 90)}`
      );
    }
  }
});

test("the import route's reject and resolve_unknown actions run inside the guard", () => {
  const stripped = stripTsComments(
    read(join(SRC_ROOT, "app", "api", "gmail", "sync", "import", "route.ts"))
  );

  const authIndex = stripped.indexOf("auth.getUser()");
  assert.ok(authIndex >= 0);

  for (const action of ["reject", "resolve_unknown"]) {
    const handled = stripped.indexOf(`decision.action === "${action}"`);
    assert.ok(handled > authIndex, `${action} must be handled after the auth guard`);
  }

  // Both new actions act only on ids this user owns: the route verifies every
  // referenced activity row up front and re-checks any named application.
  assert.match(stripped, /\.from\("gmail_activity"\)[\s\S]{0,200}\.eq\("user_id", user\.id\)/);
  assert.match(stripped, /\.eq\("id", applicationId\)[\s\S]{0,120}\.eq\("user_id", user\.id\)/);
});

test("the reconcile route is authorized", (t) => {
  const route = join(SRC_ROOT, "app", "api", "gmail", "reconcile", "route.ts");
  const source = readOptional(route);
  if (source === null) {
    t.diagnostic("the reconcile route has not landed yet — skipped");
    return;
  }

  const stripped = stripTsComments(source);
  const authIndex = stripped.indexOf("auth.getUser()");

  assert.ok(authIndex >= 0, "the reconcile route must identify the caller");
  assert.match(stripped, /if \(authError \|\| !user\)/);
  assert.ok(stripped.search(/401/) > authIndex);

  const runIndex = stripped.indexOf("runReconciliation(");
  assert.ok(runIndex > authIndex, "reconciliation must not run for an anonymous caller");
});

// ---------------------------------------------------------------------------
// The automatic path never invents an employer, a role, or an application
// ---------------------------------------------------------------------------

test("the automatic path never writes an Unknown company or Unknown role", (t) => {
  for (const name of ["autoImport.ts", "reconcile.ts"]) {
    const source = readOptional(precisionModulePath(name));
    if (source === null) {
      t.diagnostic(`${name} has not landed yet — skipped`);
      continue;
    }

    const stripped = stripTsComments(source);

    // Asserted on the WRITE path only. `reconcile.ts` legitimately matches
    // against the exact placeholder strings to repair rows the user-approved
    // import route created; what it must never do is store one.
    for (const payload of writePayloads(stripped)) {
      assert.equal(
        /Unknown company|Unknown role/.test(payload),
        false,
        `${name} writes a placeholder: ${payload.slice(0, 100)}`
      );
    }
  }

  // A ROLE is never fabricated: the Auto_Importer must not contain the role
  // placeholder string anywhere.
  const autoImport = stripTsComments(read(precisionModulePath("autoImport.ts")));
  assert.equal(
    /Unknown role/.test(autoImport),
    false,
    "the Auto_Importer must never name a role placeholder"
  );

  // "Unknown company" MAY appear, but ONLY as the single exported placeholder
  // constant that reconcile.ts is built to upgrade — never inside an insert
  // payload as a fabricated employer, and never more than once. Strong evidence
  // that the user applied is persisted under this explicit "we do not know yet"
  // marker rather than withheld (FIX 1); a real or portal employer can still
  // never be fabricated, which the write-payload loop above and
  // `sanitizeCompanyName` guarantee.
  const companyPlaceholders = autoImport.match(/"Unknown company"/g) ?? [];
  assert.equal(
    companyPlaceholders.length,
    1,
    "the placeholder may appear only as the single UNRESOLVED_COMPANY constant"
  );
  assert.match(
    autoImport,
    /UNRESOLVED_COMPANY = "Unknown company"/,
    "the only occurrence must be the exported reconcilable placeholder constant"
  );
});

test("weak or null evidence can never auto-create an application", () => {
  const stripped = stripTsComments(read(precisionModulePath("autoImport.ts")));

  const creates = stripped.match(/action: "create"/g) ?? [];
  assert.equal(creates.length, 1, "there should be exactly one create path");

  // The condition immediately guarding the create branch must require strong
  // evidence. A null stored strength reads as not-strong, so pre-gate rows and
  // every model-derived category are excluded by construction.
  const createIndex = stripped.indexOf('action: "create"');
  const guard = stripped.slice(0, createIndex);
  const lastIf = guard.lastIndexOf("if (");
  assert.ok(lastIf >= 0, "the create branch should be guarded");

  // The create branch is guarded by `strongLifecycle`, and that variable is
  // defined as requiring BOTH strong evidence AND a lifecycle event. A null
  // stored strength reads as not-strong, so pre-gate rows and every
  // model-derived category are still excluded by construction. The employer is
  // deliberately NOT part of this guard any more (FIX 1: strong unresolved
  // evidence must still create) — the anti-fabrication guarantee is enforced at
  // the write instead, asserted below.
  const condition = guard.slice(lastIf);
  assert.match(condition, /strongLifecycle/);
  assert.match(
    stripped,
    /strongLifecycle = proposal\.hasStrongEvidence && proposal\.isLifecycleEvent/,
    "strong-lifecycle must require both strong evidence and a lifecycle event"
  );

  // The writer never fabricates an employer: a null resolves to the explicit
  // reconcilable placeholder, and `sanitizeCompanyName` is applied first so a
  // real or portal name can never be invented.
  assert.match(
    stripped,
    /sanitizeCompanyName\(proposal\.company\) \?\? UNRESOLVED_COMPANY/,
    "applyCreate must store the explicit placeholder, never a fabricated employer"
  );
});

// ===========================================================================
// SPRINT 10 — the application status lifecycle and its history table
// ===========================================================================
//
// The same idea applied to the status-history work: assertions about the source
// tree and the migration that no unit test on a single function can make.
//
//   1. the Sprint 10 migration staying additive, re-runnable and owner-scoped,
//   2. the history table storing no email text and no credential,
//   3. ownership — every history statement scoped to the acting user, so one
//      user's trail is unreachable from another's session,
//   4. no status-history data reaching an AI provider.

const SPRINT10_MIGRATION = join(
  process.cwd(),
  "supabase-schema-sprint10-application-lifecycle.sql"
);

const APPLICATIONS_DATA_LAYER = join(SRC_ROOT, "lib", "api", "applications.ts");
const LIFECYCLE_MODULE = join(SRC_ROOT, "lib", "applications", "lifecycle.ts");

function sprint10Sql(): string {
  const sql = readOptional(SPRINT10_MIGRATION);
  assert.ok(
    sql,
    "supabase-schema-sprint10-application-lifecycle.sql should exist"
  );
  return stripSqlComments(sql);
}

// ---------------------------------------------------------------------------
// The migration is additive and re-runnable
// ---------------------------------------------------------------------------

test("the Sprint 10 migration never touches the applications table definition", () => {
  const executable = sprint10Sql();

  // The lifecycle is built on the EXISTING five statuses, so the frozen
  // applications table and its status CHECK constraint stay exactly as they are.
  assert.equal(
    /ALTER TABLE\s+public\.applications/i.test(executable),
    false,
    "the applications table and its status CHECK constraint are frozen"
  );
  assert.equal(/DROP CONSTRAINT/i.test(executable), false);
  assert.equal(/ALTER COLUMN/i.test(executable), false);
  assert.equal(/DROP COLUMN/i.test(executable), false);
  assert.equal(/DROP (?:INDEX|POLICY|TABLE|TRIGGER)/i.test(executable), false);

  // No backfill and no deletion: legacy applications simply have no history.
  assert.equal(
    /INSERT INTO public\.application_status_history[\s\S]{0,200}SELECT/i.test(
      executable
    ),
    false,
    "history must not be backfilled from existing rows"
  );
  assert.equal(/\bDELETE FROM\b/i.test(executable), false);
  assert.equal(/\bTRUNCATE\b/i.test(executable), false);
});

test("the Sprint 10 migration is re-runnable", () => {
  const executable = sprint10Sql();

  assert.match(
    executable,
    /CREATE TABLE IF NOT EXISTS public\.application_status_history/i
  );

  const createIndexes =
    executable.match(/CREATE\s+INDEX(?:\s+IF NOT EXISTS)?/gi) ?? [];
  assert.equal(createIndexes.length, 2, "both history indexes should be created");
  for (const clause of createIndexes) {
    assert.match(clause, /IF NOT EXISTS/i);
  }

  // Required indexes, by their columns.
  assert.match(executable, /application_status_history\(application_id, changed_at DESC\)/i);
  assert.match(executable, /application_status_history\(user_id, changed_at DESC\)/i);

  // CREATE POLICY has no IF NOT EXISTS in Postgres, so every policy sits behind
  // an explicit pg_policies existence check rather than a DROP.
  const policies = executable.match(/CREATE POLICY/gi) ?? [];
  assert.equal(policies.length, 4, "all four owner policies should be created");
  const guards = executable.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/gi) ?? [];
  assert.equal(
    guards.length,
    policies.length,
    "every policy must be guarded so a re-run is a no-op"
  );

  // The function is replaced in place, never dropped and recreated.
  assert.match(
    executable,
    /CREATE OR REPLACE FUNCTION public\.update_application_status/i
  );
});

test("the history table is owner-scoped by RLS, never permissive", () => {
  const executable = sprint10Sql();

  assert.match(
    executable,
    /ALTER TABLE public\.application_status_history\s+ENABLE ROW LEVEL SECURITY/i
  );

  for (const operation of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.ok(
      new RegExp(`ON public\\.application_status_history FOR ${operation}`).test(
        executable
      ),
      `application_status_history needs a ${operation} policy`
    );
  }

  assert.ok(executable.includes("auth.uid() = user_id"));
  assert.equal(/USING\s*\(\s*true\s*\)/i.test(executable), false);
  assert.equal(/WITH CHECK\s*\(\s*true\s*\)/i.test(executable), false);

  // Both foreign keys, so a deleted application or user takes its trail with it.
  assert.match(
    executable,
    /application_id UUID NOT NULL\s+REFERENCES public\.applications\(id\) ON DELETE CASCADE/i
  );
  assert.match(
    executable,
    /user_id UUID NOT NULL\s+REFERENCES auth\.users\(id\)/i
  );
});

test("the status function runs as the caller and still filters on auth.uid()", () => {
  const executable = sprint10Sql();

  // SECURITY INVOKER keeps the caller's RLS policies in force. A DEFINER
  // function would bypass them, making the explicit filter the ONLY guard.
  assert.match(executable, /SECURITY INVOKER/i);
  assert.equal(/SECURITY DEFINER/i.test(executable), false);

  // And ownership is enforced in the statements too, not only by RLS.
  assert.match(executable, /v_user_id UUID := auth\.uid\(\)/i);
  const ownerFilters = executable.match(/user_id = v_user_id/g) ?? [];
  assert.ok(
    ownerFilters.length >= 2,
    "the row lock and the update must both filter on the acting user"
  );

  // The row is locked before its status is read, which is what makes the
  // read-validate-update-append sequence atomic.
  assert.match(executable, /FROM public\.applications[\s\S]{0,160}FOR UPDATE/i);

  // Exactly one history insert in the whole function.
  const inserts =
    executable.match(/INSERT INTO public\.application_status_history/gi) ?? [];
  assert.equal(inserts.length, 1, "a change must append exactly one row");

  // A no-op returns before either write.
  const noOp = executable.indexOf("v_current = p_status");
  const update = executable.search(/UPDATE public\.applications/i);
  assert.ok(noOp >= 0 && update > noOp, "the no-op check must precede the write");
});

test("the history table stores no email text and no credential", () => {
  const executable = sprint10Sql();

  for (const forbidden of [
    "body_text",
    "email_body",
    "raw_body",
    "snippet",
    "subject",
    "sender",
    "access_token",
    "refresh_token",
    "gmail_message_id",
  ]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`, "i").test(executable),
      false,
      `the history table must not carry ${forbidden}`
    );
  }
});

// ---------------------------------------------------------------------------
// Ownership — history can never cross users
// ---------------------------------------------------------------------------

test("every status-history statement is scoped to the acting user", () => {
  const source = read(APPLICATIONS_DATA_LAYER);

  const historyStatements = supabaseStatements(source).filter((statement) =>
    statement.includes("application_status_history")
  );
  assert.ok(
    historyStatements.length >= 2,
    "the data layer should read the history table"
  );

  for (const statement of historyStatements) {
    assert.ok(
      statement.includes('.eq("user_id", userId)'),
      `a history statement has no user scope: ${statement.slice(0, 90)}`
    );
  }

  const stripped = stripTsComments(source);

  // The ownership re-check before a status write filters on BOTH the id and the
  // owner, so a known application id is never enough on its own.
  assert.match(
    stripped,
    /\.eq\("id", applicationId\)[\s\S]{0,80}\.eq\("user_id", userId\)/
  );

  // And the acting user is taken from the session, then compared with the id the
  // caller supplied — a caller cannot act as someone else.
  assert.match(stripped, /actingUserId !== userId/);
});

test("the status write goes through the atomic function, not a bare update", () => {
  const stripped = stripTsComments(read(APPLICATIONS_DATA_LAYER));

  assert.match(stripped, /\.rpc\(\s*"update_application_status"/);

  // No statement in this module may write `status` directly: the form save
  // deliberately leaves it out so it cannot bypass the lifecycle. `status` on an
  // INSERT is a creation, not a transition, and is allowed.
  for (const payload of writePayloads(stripped)) {
    const isInsert = /user_id:/.test(payload);
    if (isInsert) continue;
    assert.equal(
      /\bstatus:/.test(payload),
      false,
      `an update writes status directly: ${payload.slice(0, 100)}`
    );
  }
});

test("the transition table stays a pure module", () => {
  const stripped = stripTsComments(read(LIFECYCLE_MODULE));

  // No persistence and no network: the rules have to be readable by the UI and
  // by the data layer without either pulling the other in.
  assert.equal(stripped.includes(".from("), false);
  assert.equal(/\bfetch\(/.test(stripped), false);
  assert.equal(/\.rpc\(/.test(stripped), false);
  assert.equal(/createClient/.test(stripped), false);
});

// ---------------------------------------------------------------------------
// No status-history data reaches an AI provider
// ---------------------------------------------------------------------------

test("no module sends status history to an AI provider", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const stripped = stripTsComments(read(file));

    const usesAi = /from\s+["'][^"']*(?:\/ai\/|@\/lib\/ai)/.test(stripped);
    if (!usesAi) continue;

    const usesHistory =
      /application_status_history/.test(stripped) ||
      /fetchApplicationStatusHistory|fetchRecentStatusHistory|ApplicationStatusHistory/.test(
        stripped
      );

    if (usesHistory) offenders.push(relative(file));
  }

  assert.deepEqual(
    offenders,
    [],
    `status history must not reach the AI layer:\n${offenders.join("\n")}`
  );

  // Nor may the prompts name the table or its columns.
  const prompts = stripTsComments(read(join(SRC_ROOT, "lib", "ai", "prompts.ts")));
  assert.equal(/application_status_history|from_status|to_status/.test(prompts), false);

  // And the data layer itself makes no outbound call.
  const dataLayer = stripTsComments(read(APPLICATIONS_DATA_LAYER));
  assert.equal(/\bfetch\(/.test(dataLayer), false);
  assert.equal(/_API_KEY/.test(dataLayer), false);
});

// ===========================================================================
// SPRINT 13 — Gmail OAuth token isolation (C-001)
// ===========================================================================
//
// The browser and the server share one publishable/anon key, so a signed-in
// user's session could read the OAuth secret columns off their own
// gmail_connections row. These tests lock in the fix: token columns are read
// and written only through a server-only service-role client, the ordinary
// metadata read never selects them, and the migration revokes their SELECT from
// the two client-facing roles — all without weakening RLS or ownership.

const ADMIN_CLIENT = join(SRC_ROOT, "lib", "supabase", "admin.ts");
const GMAIL_DATA_LAYER = join(SRC_ROOT, "lib", "api", "gmail.ts");
const SPRINT13_MIGRATION = join(
  process.cwd(),
  "supabase-schema-sprint13-gmail-token-isolation.sql"
);

// ---------------------------------------------------------------------------
// The service-role client is server-only and never public
// ---------------------------------------------------------------------------

test("the service-role admin client exists and is server-only", () => {
  const source = readOptional(ADMIN_CLIENT);
  assert.ok(source, "src/lib/supabase/admin.ts should exist");

  // Reads the SERVER-ONLY key name, never a NEXT_PUBLIC_ one.
  assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(
    /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(source),
    false,
    "the service-role key must never be exposed under a NEXT_PUBLIC_ name"
  );

  // Fails fast if ever pulled into a browser bundle.
  assert.match(source, /typeof window !== "undefined"/);

  // Non-persistent: no browser cookie session, nothing to auto-refresh.
  assert.match(source, /persistSession:\s*false/);
  assert.match(source, /autoRefreshToken:\s*false/);
});

test("no client component imports the service-role admin client", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const contents = read(file);
    if (!isClientComponent(contents)) continue;

    if (/from\s+["'][^"']*lib\/supabase\/admin["']|from\s+["'][^"']*supabase\/admin\.ts["']/.test(contents)) {
      offenders.push(relative(file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `the service-role client leaked into the client bundle:\n${offenders.join("\n")}`
  );
});

test("SUPABASE_SERVICE_ROLE_KEY is never referenced under a NEXT_PUBLIC_ name", () => {
  for (const file of sourceFiles()) {
    const contents = read(file);
    assert.equal(
      /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE_KEY/.test(contents),
      false,
      `${relative(file)} exposes the service-role key to the browser`
    );
  }
});

// ---------------------------------------------------------------------------
// The metadata read never selects the token columns
// ---------------------------------------------------------------------------

test("the token-free column list excludes both OAuth secret columns", () => {
  const source = read(GMAIL_DATA_LAYER);

  const match = source.match(/const TOKEN_FREE_COLUMNS\s*=\s*"([^"]*)"/);
  assert.ok(match, "gmail.ts should define a TOKEN_FREE_COLUMNS list");

  const columns = match[1];
  assert.equal(
    /\baccess_token\b/.test(columns),
    false,
    "the metadata column list must not include access_token"
  );
  assert.equal(
    /\brefresh_token\b/.test(columns),
    false,
    "the metadata column list must not include refresh_token"
  );

  // The metadata read uses that list, not `*`.
  assert.match(source, /\.select\(TOKEN_FREE_COLUMNS\)/);
});

test("the token-free metadata read routes through the service-role client", () => {
  const source = read(GMAIL_DATA_LAYER);
  const stripped = stripTsComments(source);

  // Isolate `findRowForUser` — the read behind getGmailConnection /
  // getGmailConnectionGoogleSub — from the token-row read that follows it.
  const start = stripped.indexOf("async function findRowForUser");
  const end = stripped.indexOf("async function findTokenRowForUser");
  assert.ok(start >= 0, "findRowForUser should exist");
  assert.ok(end > start, "findTokenRowForUser should follow findRowForUser");
  const metadataRead = stripped.slice(start, end);

  // Sprint 14 removed table-level SELECT on gmail_connections from the
  // authenticated/anon roles, so a metadata read under the caller's
  // authenticated client raises `42501 permission denied for table
  // gmail_connections`. The read must therefore obtain the service-role client,
  // exactly as the token read does — this assertion is the corrected, more
  // secure behaviour (the read previously ran on the passed-in authenticated
  // client, which is what produced the production permission error).
  assert.match(
    metadataRead,
    /const admin = createAdminClient\(\)/,
    "findRowForUser must read via the service-role client, not the authenticated client"
  );

  // It still selects ONLY the token-free columns — never `*` — so no OAuth
  // secret is ever read on this path even with a privileged client.
  assert.match(metadataRead, /\.select\(TOKEN_FREE_COLUMNS\)/);
  assert.doesNotMatch(
    metadataRead,
    /\.select\(\s*"\*"\s*\)/,
    "the metadata read must never select all columns"
  );

  // And the ownership predicate is preserved: the privileged client only ever
  // reads the caller's own row.
  assert.match(metadataRead, /\.eq\("user_id", userId\)/);
});

// ---------------------------------------------------------------------------
// Token I/O goes through the service-role client, ownership predicates intact
// ---------------------------------------------------------------------------

test("token reads and writes route through the service-role client", () => {
  const source = read(GMAIL_DATA_LAYER);
  const stripped = stripTsComments(source);

  // The data layer obtains the admin client and uses it for the token row read.
  assert.match(stripped, /import\s*\{\s*createAdminClient\s*\}\s*from\s+["'][^"']*supabase\/admin\.ts["']/);
  assert.match(stripped, /async function findTokenRowForUser/);
  assert.match(stripped, /const admin = createAdminClient\(\)/);

  // The token read is still owner-scoped.
  assert.match(
    stripped,
    /findTokenRowForUser[\s\S]*?\.from\("gmail_connections"\)[\s\S]*?\.eq\("user_id", userId\)/
  );

  // getGmailTokensForServer reads via the token row, not the metadata read.
  assert.match(
    stripped,
    /getGmailTokensForServer[\s\S]*?findTokenRowForUser\(resolvedUserId\)/
  );

  // Every token-column write goes through `admin.from`, never the passed-in
  // authenticated client, and keeps its user_id predicate.
  assert.match(stripped, /await admin\s*\n?\s*\.from\("gmail_connections"\)\s*\n?\s*\.insert/);
  const adminUpdates = stripped.match(/await admin\s*\.from\("gmail_connections"\)\s*\.update/g) ?? [];
  assert.ok(
    adminUpdates.length >= 3,
    "upsert, refresh, disconnect and deactivate token writes must use the service-role client"
  );
});

test("the public GmailConnection shape still carries no token fields", () => {
  const source = read(GMAIL_DATA_LAYER);
  const iface = source.match(/export interface GmailConnection \{[\s\S]*?\n\}/);
  assert.ok(iface, "the GmailConnection interface should exist");
  assert.equal(
    /access_token|refresh_token|accessToken|refreshToken/.test(iface[0]),
    false,
    "no token field may ever be returned to callers"
  );
});

// ---------------------------------------------------------------------------
// The migration revokes token-column SELECT without weakening RLS
// ---------------------------------------------------------------------------

test("the Sprint 13 migration revokes token-column SELECT from both client roles", () => {
  const sql = readOptional(SPRINT13_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint13-gmail-token-isolation.sql should exist");

  const executable = stripSqlComments(sql);

  for (const role of ["authenticated", "anon"]) {
    assert.match(
      executable,
      new RegExp(
        `REVOKE\\s+SELECT\\s*\\(\\s*access_token\\s*,\\s*refresh_token\\s*\\)\\s*ON\\s+public\\.gmail_connections\\s*FROM\\s+${role}`,
        "i"
      ),
      `the migration must revoke token-column SELECT from ${role}`
    );
  }
});

test("the Sprint 13 migration does not weaken RLS or ownership", () => {
  const sql = readOptional(SPRINT13_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint13-gmail-token-isolation.sql should exist");

  const executable = stripSqlComments(sql);

  assert.equal(/DISABLE ROW LEVEL SECURITY/i.test(executable), false);
  assert.equal(/DROP POLICY/i.test(executable), false);
  assert.equal(/DROP TABLE/i.test(executable), false);
  assert.equal(/DROP COLUMN/i.test(executable), false);
  assert.equal(/ALTER COLUMN/i.test(executable), false);
  // A blanket re-grant would undo the revoke.
  assert.equal(
    /GRANT\s+SELECT[\s\S]*gmail_connections/i.test(executable),
    false,
    "the migration must not re-grant table-wide SELECT"
  );
});

// ===========================================================================
// SPRINT 14 — table-level SELECT correction (C-001 follow-up)
// ===========================================================================
//
// Sprint 13's column-level REVOKE was ineffective while the client roles kept
// TABLE-LEVEL SELECT: in PostgreSQL a role reads a column if it has EITHER a
// table-level OR a column-level grant, and a column REVOKE cannot subtract from
// a table grant. Sprint 14 removes the table-wide SELECT and re-grants SELECT on
// ONLY the token-free columns to `authenticated`. These tests lock that in.

const SPRINT14_MIGRATION = join(
  process.cwd(),
  "supabase-schema-sprint14-gmail-token-grant-fix.sql"
);

test("the Sprint 14 migration removes table-wide SELECT from both client roles", () => {
  const sql = readOptional(SPRINT14_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint14-gmail-token-grant-fix.sql should exist");

  const executable = stripSqlComments(sql);

  for (const role of ["authenticated", "anon"]) {
    assert.match(
      executable,
      new RegExp(
        `REVOKE\\s+SELECT\\s+ON\\s+public\\.gmail_connections\\s+FROM\\s+${role}`,
        "i"
      ),
      `the migration must revoke table-level SELECT from ${role}`
    );
  }
});

test("the Sprint 14 migration re-grants SELECT on exactly the token-free columns", () => {
  const sql = readOptional(SPRINT14_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint14-gmail-token-grant-fix.sql should exist");

  const executable = stripSqlComments(sql);

  // Exactly one GRANT SELECT (...) block, to authenticated only.
  const grant = executable.match(
    /GRANT\s+SELECT\s*\(([\s\S]*?)\)\s*ON\s+public\.gmail_connections\s+TO\s+authenticated/i
  );
  assert.ok(grant, "the migration must grant column-level SELECT to authenticated");

  const grantedColumns = grant[1]
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column.length > 0)
    .sort();

  // The list must match TOKEN_FREE_COLUMNS in gmail.ts exactly — no more, no less.
  const dataLayer = read(GMAIL_DATA_LAYER);
  const tokenFree = dataLayer.match(/const TOKEN_FREE_COLUMNS\s*=\s*\n?\s*"([^"]*)"/);
  assert.ok(tokenFree, "gmail.ts should define TOKEN_FREE_COLUMNS");

  const expectedColumns = tokenFree[1]
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column.length > 0)
    .sort();

  assert.deepEqual(
    grantedColumns,
    expectedColumns,
    "the GRANT column list must exactly match TOKEN_FREE_COLUMNS"
  );
});

test("the Sprint 14 migration never grants the OAuth secret columns to a client role", () => {
  const sql = readOptional(SPRINT14_MIGRATION);
  assert.ok(sql, "supabase-schema-sprint14-gmail-token-grant-fix.sql should exist");

  const executable = stripSqlComments(sql);

  // No GRANT anywhere may include a token column.
  const grants = executable.match(/GRANT[\s\S]*?;/gi) ?? [];
  for (const grant of grants) {
    assert.equal(
      /\baccess_token\b/.test(grant),
      false,
      "access_token must never be granted to a client role"
    );
    assert.equal(
      /\brefresh_token\b/.test(grant),
      false,
      "refresh_token must never be granted to a client role"
    );
  }

  // anon is deliberately not re-granted SELECT, and table-wide SELECT is not
  // restored to either client role.
  assert.equal(
    /GRANT\s+SELECT\s*\([\s\S]*?\)\s*ON\s+public\.gmail_connections\s+TO\s+anon/i.test(
      executable
    ),
    false,
    "anon must not be re-granted column SELECT"
  );
  assert.equal(
    /GRANT\s+SELECT\s+ON\s+public\.gmail_connections\s+TO\s+(?:authenticated|anon)/i.test(
      executable
    ),
    false,
    "table-wide SELECT must not be re-granted to a client role"
  );

  // service_role privileges are not touched by this migration.
  assert.equal(
    /service_role/i.test(executable),
    false,
    "the migration must not alter service_role privileges"
  );
});

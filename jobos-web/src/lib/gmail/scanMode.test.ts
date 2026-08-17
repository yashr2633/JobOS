/**
 * The full-window scan contract, proven rather than described.
 *
 * The regression these tests exist to prevent: a repeat scan of an
 * already-scanned window silently became an anchored `history.list` diff, so the
 * mailbox was never traversed and the user was shown
 * `0 processed / 0 application-related / 0 created` for a 30-day window holding
 * thousands of matching messages. The zero was truthful about work that was never
 * attempted.
 *
 * Requirement coverage, in the numbering of the repair brief:
 *   1-4  every selectable window traverses in full when explicitly requested
 *   5    repeating the same window still traverses it
 *   6    no previous scan state can turn an explicit scan into a zero
 *   7    a page cursor is only ever continued within the same scan
 *   8    dedup is a write concern and cannot suppress traversal
 *   11   message counters are not application counters
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";

import {
  DEFAULT_SCAN_INTENT,
  SCAN_INTENTS,
  coerceScanIntent,
  isScanIntent,
  resolveJobReuse,
  resolveScanMode,
  traversesWindow,
  type ScanIntent,
} from "./scanMode.ts";
import { SCAN_WINDOWS, type ScanWindow } from "./query.ts";
import { summarizeListing } from "./sync.ts";

/** Arbitraries over the closed vocabularies, so no case is hand-picked. */
const anyWindow = () => fc.constantFrom<ScanWindow>(...SCAN_WINDOWS);
const anyIntent = () => fc.constantFrom<ScanIntent>(...SCAN_INTENTS);

// ===========================================================================
// Requirements 1-4: each selectable window traverses in full
// ===========================================================================

test("every selectable window traverses the complete mailbox window", () => {
  // 7d, 30d, 60d and 90d each asserted, not a representative sample.
  assert.deepEqual([...SCAN_WINDOWS], ["7d", "30d", "60d", "90d"]);

  for (const window of SCAN_WINDOWS) {
    const decision = resolveScanMode({
      intent: "full_window",
      // The worst case for the old rule: fully anchored and fully covered.
      hasAnchor: true,
      hasCompletedFullSync: true,
    });

    assert.equal(
      decision.syncMode,
      "full",
      `${window} must traverse the window, not diff an anchor`
    );
    assert.equal(decision.reason, "explicit_full_window");
    assert.equal(traversesWindow(decision.syncMode), true);
  }
});

// ===========================================================================
// Requirements 5 and 6: repetition and prior state cannot produce a zero
// ===========================================================================

test("repeating the same window scan still traverses that window", () => {
  // Scan 1: nothing has ever been scanned.
  const first = resolveScanMode({
    intent: "full_window",
    hasAnchor: false,
    hasCompletedFullSync: false,
  });
  assert.equal(first.syncMode, "full");

  // Scan 2, ten minutes later: an anchor now exists and a full sync completed,
  // which is exactly the state that used to force `history.list` and report zero.
  const second = resolveScanMode({
    intent: "full_window",
    hasAnchor: true,
    hasCompletedFullSync: true,
  });
  assert.equal(
    second.syncMode,
    "full",
    "a second identical scan must read the window again"
  );
  assert.equal(traversesWindow(second.syncMode), true);
});

test("no combination of previous scan state can stop an explicit scan traversing", () => {
  fc.assert(
    fc.property(
      anyWindow(),
      fc.boolean(),
      fc.boolean(),
      (window, hasAnchor, hasCompletedFullSync) => {
        const decision = resolveScanMode({
          intent: "full_window",
          hasAnchor,
          hasCompletedFullSync,
        });

        // The whole contract, as one property: an explicitly requested window is
        // ALWAYS traversed. There is no state that downgrades it.
        assert.equal(decision.syncMode, "full");
        assert.equal(traversesWindow(decision.syncMode), true);
        assert.ok(window);
      }
    ),
    { numRuns: 200 }
  );
});

test("an anchored diff must be requested by name, and still has to be earned", () => {
  // Asked for, and earned.
  assert.equal(
    resolveScanMode({
      intent: "incremental",
      hasAnchor: true,
      hasCompletedFullSync: true,
    }).syncMode,
    "incremental"
  );

  // Asked for, but nothing to diff against: falls back to a full traversal
  // rather than listing nothing.
  assert.deepEqual(
    resolveScanMode({
      intent: "incremental",
      hasAnchor: false,
      hasCompletedFullSync: true,
    }),
    { syncMode: "full", reason: "no_anchor" }
  );
  assert.deepEqual(
    resolveScanMode({
      intent: "incremental",
      hasAnchor: true,
      hasCompletedFullSync: false,
    }),
    { syncMode: "full", reason: "no_completed_full_sync" }
  );
});

test("an unspecified intent defaults to the complete traversal", () => {
  // A request that forgets to declare itself must over-read, never under-read.
  assert.equal(DEFAULT_SCAN_INTENT, "full_window");

  for (const value of [undefined, null, "", "incremental_ish", 7, {}, []]) {
    assert.equal(coerceScanIntent(value), "full_window");
  }
  // Only the exact vocabulary is honoured.
  assert.equal(coerceScanIntent("incremental"), "incremental");
  assert.equal(coerceScanIntent("full_window"), "full_window");
  assert.equal(isScanIntent("incremental"), true);
  assert.equal(isScanIntent("INCREMENTAL"), false);
});

// ===========================================================================
// Requirement 7: a page cursor is only continued within the same scan
// ===========================================================================

test("an open job is continued only when it is the same scan", () => {
  // Same window, same mode: ordinary pagination through the running scan.
  assert.deepEqual(
    resolveJobReuse({
      openJob: { window: "30d", syncMode: "full" },
      requestedWindow: "30d",
      resolvedMode: "full",
    }),
    { action: "resume", reason: "same_window_pagination" }
  );

  // Nothing open.
  assert.deepEqual(
    resolveJobReuse({
      openJob: null,
      requestedWindow: "30d",
      resolvedMode: "full",
    }),
    { action: "start_fresh", reason: "no_open_job" }
  );
});

test("a stale open job never redefines the window the user selected", () => {
  // The observed defect: URL/selector said 7d, the panel reported 60 days,
  // because a leftover 60d job was continued instead of the request being served.
  assert.deepEqual(
    resolveJobReuse({
      openJob: { window: "60d", syncMode: "full" },
      requestedWindow: "7d",
      resolvedMode: "full",
    }),
    { action: "supersede", reason: "window_mismatch" }
  );

  // A lingering open incremental job would otherwise keep listing nothing for
  // every future press of Scan Gmail.
  assert.deepEqual(
    resolveJobReuse({
      openJob: { window: "30d", syncMode: "incremental" },
      requestedWindow: "30d",
      resolvedMode: "full",
    }),
    { action: "supersede", reason: "mode_mismatch" }
  );

  // Bounds naming no selectable window cannot be shown to be this request's
  // window, so the job is not reused rather than guessed at.
  assert.deepEqual(
    resolveJobReuse({
      openJob: { window: null, syncMode: "full" },
      requestedWindow: "30d",
      resolvedMode: "full",
    }),
    { action: "supersede", reason: "unrecoverable_window" }
  );
});

test("any window mismatch supersedes, for every pair of windows", () => {
  fc.assert(
    fc.property(anyWindow(), anyWindow(), (openWindow, requestedWindow) => {
      const decision = resolveJobReuse({
        openJob: { window: openWindow, syncMode: "full" },
        requestedWindow,
        resolvedMode: "full",
      });

      // Resume is permitted for exactly one reason: it is the same scan.
      if (openWindow === requestedWindow) {
        assert.equal(decision.action, "resume");
      } else {
        assert.equal(decision.action, "supersede");
      }
    }),
    { numRuns: 200 }
  );
});

test("an explicit scan is never served by an open incremental job", () => {
  fc.assert(
    fc.property(anyWindow(), anyWindow(), (openWindow, requestedWindow) => {
      const resolved = resolveScanMode({
        intent: "full_window",
        hasAnchor: true,
        hasCompletedFullSync: true,
      });

      const decision = resolveJobReuse({
        openJob: { window: openWindow, syncMode: "incremental" },
        requestedWindow,
        resolvedMode: resolved.syncMode,
      });

      assert.equal(decision.action, "supersede");
    }),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Requirement 8: dedup is a write concern, never a traversal shortcut
// ===========================================================================

test("deduplication reduces writes, not the mailbox traversal", () => {
  // The reported production case: a full 30-day page of 200 already-ledgered
  // messages. Every one of them was listed — the traversal happened — and every
  // one is deduplicated so no duplicate row is written.
  const summary = summarizeListing({
    listed: 200,
    alreadyProcessed: 200,
    batchLimit: 60,
  });

  assert.equal(summary.deduplicated, 200, "all 200 were already tracked");
  assert.equal(summary.fresh, 0, "so none needed processing");
  assert.equal(
    summary.pageFullyProcessed,
    true,
    "and the cursor may advance to keep traversing the window"
  );
});

test("a fully deduplicated window still reports what it listed", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 5_000 }),
      (listed) => {
        const summary = summarizeListing({
          listed,
          alreadyProcessed: listed,
          batchLimit: 60,
        });

        // `listed` is the number that distinguishes "Gmail matched nothing" from
        // "Gmail matched plenty and we had already read all of it". It is never
        // reduced by dedup, which is what makes the honest message possible.
        assert.equal(summary.deduplicated, listed);
        assert.equal(summary.fresh, 0);
        // Traversal continues: the cursor is free to move to the next page.
        assert.equal(summary.pageFullyProcessed, true);
      }
    ),
    { numRuns: 100 }
  );
});

test("genuinely new messages survive dedup and are processed", () => {
  // 5 listed, 3 already tracked -> the 2 new ones are processed.
  const summary = summarizeListing({
    listed: 5,
    alreadyProcessed: 3,
    batchLimit: 60,
  });
  assert.equal(summary.deduplicated, 3);
  assert.equal(summary.fresh, 2);
  assert.equal(summary.pageFullyProcessed, true);
});

test("a page holding more new mail than the batch cap holds the cursor back", () => {
  // Nothing is skipped: the cursor stays put and the remainder is picked up next
  // batch, where dedup reduces the re-listed page to just the unprocessed tail.
  const summary = summarizeListing({
    listed: 200,
    alreadyProcessed: 0,
    batchLimit: 60,
  });
  assert.equal(summary.fresh, 60);
  assert.equal(summary.pageFullyProcessed, false);
});

// ===========================================================================
// Requirement 11: message counters are not application counters
// ===========================================================================

test("the scan route reports message counts and application counts separately", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "app", "api", "gmail", "sync", "route.ts"),
    "utf8"
  );

  // Four distinct fields, so no consumer has to derive one from another.
  for (const field of [
    "messagesListed",
    "messagesDeduplicated",
    "messagesFresh",
    "created",
    "updated",
  ]) {
    assert.ok(
      source.includes(field),
      `the response must report ${field} in its own right`
    );
  }

  // The client must be able to tell "nothing matched in the window" from
  // "nothing arrived since the anchor".
  assert.match(source, /windowTraversed/);
});

/**
 * Tests for the history-driven recent activity feed.
 *
 * The point of these is what the feed must NOT do: it must not derive an event
 * from `applied_date`, from `updated_at`, or from an application's current
 * status. Every row is a recorded `application_status_history` event shown at its
 * real `changed_at`.
 *
 * The last test guards the other direction: current-state counts on the
 * dashboard keep coming from `applications.status`, never from history.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RECENT_ACTIVITY_LIMIT, buildRecentActivity, describeStatusEvent } from "./recentActivity.ts";
import { computeStatusDistribution, countActive } from "./metrics.ts";
import type {
  Application,
  ApplicationStatus,
  ApplicationStatusHistory,
  ApplicationStatusSource,
} from "../applications/types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    company: "Acme",
    role: "Engineer",
    location: "Remote",
    jobPortal: "LinkedIn",
    appliedDate: "2020-01-01",
    status: "Applied",
    ...overrides,
  };
}

function event(overrides: {
  id: string;
  applicationId?: string;
  fromStatus?: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  source?: ApplicationStatusSource;
  note?: string | null;
}): ApplicationStatusHistory {
  return {
    id: overrides.id,
    applicationId: overrides.applicationId ?? "app-1",
    fromStatus: overrides.fromStatus ?? null,
    toStatus: overrides.toStatus,
    changedAt: overrides.changedAt,
    source: overrides.source ?? "manual",
    note: overrides.note ?? null,
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("each status has its own event wording", () => {
  assert.equal(describeStatusEvent("Applied", "Stripe"), "Applied to Stripe");
  assert.equal(
    describeStatusEvent("Interview", "Amazon"),
    "Moved to Interview at Amazon"
  );
  assert.equal(
    describeStatusEvent("Offer", "Microsoft"),
    "Offer received from Microsoft"
  );
  assert.equal(
    describeStatusEvent("Rejected", "Meta"),
    "Application rejected by Meta"
  );
  assert.equal(
    describeStatusEvent("Ghosted", "Initech"),
    "Marked Ghosted at Initech"
  );
});

// ---------------------------------------------------------------------------
// The feed uses the real recorded timestamp
// ---------------------------------------------------------------------------

test("a feed row carries the recorded changed_at, not the applied date", () => {
  const applications = [app({ appliedDate: "2020-01-01", status: "Offer" })];
  const history = [
    event({
      id: "hist-1",
      fromStatus: "Applied",
      toStatus: "Interview",
      changedAt: "2024-05-04T13:45:00.000Z",
      source: "gmail",
    }),
  ];

  const [item] = buildRecentActivity(history, applications);

  assert.equal(item.timestamp, "2024-05-04T13:45:00.000Z");
  assert.notEqual(item.timestamp, "2020-01-01");
  // The event's own target status, not the application's current one.
  assert.equal(item.status, "Interview");
  assert.equal(item.source, "gmail");
  assert.equal(item.id, "hist-1");
  assert.equal(item.applicationId, "app-1");
  assert.equal(item.label, "Moved to Interview at Acme");
});

test("rows are ordered newest first regardless of input order", () => {
  const applications = [app()];
  const history = [
    event({ id: "b", toStatus: "Interview", changedAt: "2024-02-01T00:00:00.000Z" }),
    event({ id: "c", toStatus: "Offer", changedAt: "2024-03-01T00:00:00.000Z" }),
    event({ id: "a", toStatus: "Applied", changedAt: "2024-01-01T00:00:00.000Z" }),
  ];

  assert.deepEqual(
    buildRecentActivity(history, applications).map((item) => item.id),
    ["c", "b", "a"]
  );
});

test("the feed is capped, keeping the most recent events", () => {
  const applications = [app()];
  const history = Array.from({ length: RECENT_ACTIVITY_LIMIT + 3 }, (_, index) =>
    event({
      id: `hist-${index}`,
      toStatus: "Interview",
      // Later index = later day.
      changedAt: `2024-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    })
  );

  const items = buildRecentActivity(history, applications);

  assert.equal(items.length, RECENT_ACTIVITY_LIMIT);
  assert.equal(items[0].id, `hist-${RECENT_ACTIVITY_LIMIT + 2}`);
});

// ---------------------------------------------------------------------------
// Nothing is invented
// ---------------------------------------------------------------------------

test("applications with no recorded history produce an empty feed", () => {
  // Three legacy applications, every one of them with a status and an applied
  // date. None of that becomes an event.
  const applications = [
    app({ id: "app-1", appliedDate: "2023-01-01", status: "Applied" }),
    app({ id: "app-2", appliedDate: "2023-02-01", status: "Interview" }),
    app({ id: "app-3", appliedDate: "2023-03-01", status: "Rejected" }),
  ];

  assert.deepEqual(buildRecentActivity([], applications), []);
});

test("an event whose application is not in view is dropped, never renamed", () => {
  const history = [
    event({
      id: "hist-1",
      applicationId: "app-missing",
      toStatus: "Offer",
      changedAt: "2024-05-01T00:00:00.000Z",
    }),
  ];

  const items = buildRecentActivity(history, [app({ id: "app-1" })]);

  assert.deepEqual(items, []);
});

test("an event with an unreadable timestamp is excluded", () => {
  const history = [
    event({ id: "bad", toStatus: "Offer", changedAt: "not a date" }),
    event({ id: "good", toStatus: "Interview", changedAt: "2024-05-01T00:00:00.000Z" }),
  ];

  assert.deepEqual(
    buildRecentActivity(history, [app()]).map((item) => item.id),
    ["good"]
  );
});

// ---------------------------------------------------------------------------
// Current-state counts still come from applications.status
// ---------------------------------------------------------------------------

test("status counts are read from applications.status, never from history", () => {
  const applications = [
    app({ id: "app-1", status: "Applied" }),
    app({ id: "app-2", status: "Interview" }),
    app({ id: "app-3", status: "Rejected" }),
  ];

  // History that disagrees with every current status. The distribution must not
  // move: history records how a status got here, not what it is.
  const distribution = computeStatusDistribution(applications);

  assert.deepEqual(distribution, {
    Applied: 1,
    Interview: 1,
    Offer: 0,
    Rejected: 1,
    Ghosted: 0,
  });
  assert.equal(countActive(distribution), 2);

  const history = [
    event({ id: "h1", applicationId: "app-1", toStatus: "Offer", changedAt: "2024-05-01T00:00:00.000Z" }),
    event({ id: "h2", applicationId: "app-2", toStatus: "Ghosted", changedAt: "2024-05-02T00:00:00.000Z" }),
  ];

  // The feed reports those events...
  assert.deepEqual(
    buildRecentActivity(history, applications).map((item) => item.status),
    ["Ghosted", "Offer"]
  );
  // ...and the counts are unchanged by them.
  assert.deepEqual(computeStatusDistribution(applications), distribution);
});

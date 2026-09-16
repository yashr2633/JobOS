"use client";

import { useEffect, useState } from 'react';
import type { DashboardMetrics } from '@/types/analytics';

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const response = await fetch('/api/admin/analytics');
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load analytics');
        }
        const data: DashboardMetrics = await response.json();
        setMetrics(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    }

    void fetchMetrics();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-center text-text-secondary">Loading analytics...</div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-md border border-danger/20 bg-danger-bg px-4 py-3 text-danger">
          {error || 'Failed to load analytics'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">BETA Analytics</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Session/Returning metrics tracked since {new Date(metrics.trackingSince).toLocaleDateString()}
        </p>
      </div>

      {/* BETA OVERVIEW */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Beta Overview</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Registered Users" value={metrics.users.registered} />
          <MetricCard
            label="Active Users (7d)"
            value={metrics.users.active7d}
            note="Authenticated sessions"
          />
          <MetricCard
            label="Active Users (30d)"
            value={metrics.users.active30d}
            note="Authenticated sessions"
          />
          <MetricCard
            label="Engaged Users (30d)"
            value={metrics.users.engaged30d}
            note="Meaningful product actions"
            highlight
          />
          <MetricCard
            label="Returning Users"
            value={metrics.users.returning}
            note="Active on 2+ days"
          />
        </div>
      </section>

      {/* PRODUCT ADOPTION */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Product Adoption</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdoptionCard
            label="Activated Users"
            count={metrics.adoption.activated.count}
            total={metrics.adoption.activated.total}
            percent={metrics.adoption.activated.percent}
            note="Completed at least one core workflow"
          />
          <AdoptionCard
            label="Gmail Adoption Users"
            count={metrics.adoption.gmailAdoption.count}
            total={metrics.adoption.gmailAdoption.total}
            percent={metrics.adoption.gmailAdoption.percent}
            note="Ever successfully connected Gmail"
            highlight
          />
          <AdoptionCard
            label="Currently Connected Gmail"
            count={metrics.adoption.gmailCurrentlyConnected.count}
            total={metrics.adoption.gmailCurrentlyConnected.total}
            percent={metrics.adoption.gmailCurrentlyConnected.percent}
            note="Gmail currently connected (operational)"
          />
          <AdoptionCard
            label="Gmail Sync Users"
            count={metrics.adoption.gmailSyncUsers.count}
            total={metrics.adoption.gmailSyncUsers.total}
            percent={metrics.adoption.gmailSyncUsers.percent}
            note="Completed at least one Gmail scan"
          />
          <AdoptionCard
            label="Resume Match Users"
            count={metrics.adoption.resumeMatchUsers.count}
            total={metrics.adoption.resumeMatchUsers.total}
            percent={metrics.adoption.resumeMatchUsers.percent}
            note="Completed at least one Resume Match"
          />
        </div>
      </section>

      {/* PRODUCT USAGE */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Product Usage</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Applications Tracked"
            value={metrics.usage.applicationsTracked}
            note="Unique application records"
          />
          <MetricCard
            label="Applications Added (7d)"
            value={metrics.usage.applicationsAdded7d}
          />
          <MetricCard
            label="Applications Added (30d)"
            value={metrics.usage.applicationsAdded30d}
          />
          <MetricCard
            label="Gmail Scans Completed"
            value={metrics.usage.gmailScansCompleted}
            note="Successful scan operations"
          />
          <MetricCard
            label="Gmail Scans (7d)"
            value={metrics.usage.gmailScans7d}
          />
          <MetricCard
            label="Gmail Scans (30d)"
            value={metrics.usage.gmailScans30d}
          />
          <MetricCard
            label="Resume Analyses Completed"
            value={metrics.usage.resumeAnalysesCompleted}
            note="Successful Resume Match runs"
          />
          <MetricCard
            label="Resume Analyses (7d)"
            value={metrics.usage.resumeAnalyses7d}
          />
          <MetricCard
            label="Resume Analyses (30d)"
            value={metrics.usage.resumeAnalyses30d}
          />
          <MetricCard
            label="Resumes Uploaded"
            value={metrics.usage.resumesUploaded}
            note="Unique resume records"
          />
        </div>
      </section>

      {/* Applications by Status */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">
          Applications by Status
        </h2>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-text-secondary">
                  Count
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {metrics.applicationsByStatus.map((item) => (
                <tr key={item.status}>
                  <td className="px-4 py-3 text-sm text-text">{item.status}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-text">
                    {item.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-text-muted">
        Generated: {new Date(metrics.generatedAt).toLocaleString()}
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  note?: string;
  highlight?: boolean;
}

function MetricCard({ label, value, note, highlight }: MetricCardProps) {
  return (
    <div
      className={`rounded-md border bg-surface px-4 py-3 ${
        highlight
          ? 'border-accent/30 bg-accent/5'
          : 'border-border'
      }`}
    >
      <div className="text-sm font-medium text-text-secondary">{label}</div>
      <div className="mt-2 text-3xl font-bold text-text">{value.toLocaleString()}</div>
      {note && (
        <div className="mt-1 text-xs text-text-muted">{note}</div>
      )}
    </div>
  );
}

interface AdoptionCardProps {
  label: string;
  count: number;
  total: number;
  percent: number;
  note?: string;
  highlight?: boolean;
}

function AdoptionCard({ label, count, total, percent, note, highlight }: AdoptionCardProps) {
  return (
    <div
      className={`rounded-md border bg-surface px-4 py-3 ${
        highlight
          ? 'border-accent/30 bg-accent/5'
          : 'border-border'
      }`}
    >
      <div className="text-sm font-medium text-text-secondary">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-text">{count}</span>
        <span className="text-sm text-text-muted">/ {total}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-accent">{percent}%</div>
      {note && (
        <div className="mt-1 text-xs text-text-muted">{note}</div>
      )}
    </div>
  );
}

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

      {/* GMAIL INTEGRATION */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Gmail Integration</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Gmail Accounts Tested"
            value={metrics.gmail.accountsTested}
            note="Distinct Gmail integrations that reached a scan"
            highlight
          />
          <MetricCard
            label="Gmail Scan Attempts"
            value={metrics.gmail.scanAttempts}
            note="Total Gmail scan operations, including zero-result scans"
          />
          <AdoptionCard
            label="Gmail Feature Users"
            count={metrics.gmail.featureUsers.count}
            total={metrics.gmail.featureUsers.total}
            percent={metrics.gmail.featureUsers.percent}
            note="Unique JobTrackOS users who used Gmail integration"
          />
        </div>
      </section>

      {/* PRODUCT ADOPTION */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Product Adoption</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <AdoptionCard
            label="Activated Users"
            count={metrics.adoption.activated.count}
            total={metrics.adoption.activated.total}
            percent={metrics.adoption.activated.percent}
            note="Completed at least one core workflow"
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

      {/* USAGE VOLUME */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Usage Volume</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Resumes Uploaded"
            value={metrics.usage.resumesUploaded}
            note="Unique resume records"
          />
          <MetricCard
            label="Resume Analyses (7d)"
            value={metrics.usage.resumeAnalyses7d}
          />
          <MetricCard
            label="Resume Analyses (30d)"
            value={metrics.usage.resumeAnalyses30d}
          />
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

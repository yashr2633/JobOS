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
      {/* Header with tracking note */}
      <div className="mb-6 rounded-md border border-border-strong bg-surface-2 px-4 py-3">
        <p className="text-sm text-text-secondary">
          <strong className="text-text">Analytics tracking since:</strong>{' '}
          {new Date(metrics.trackingSince).toLocaleDateString()}
          <span className="ml-4 text-text-muted">
            (Active/Returning user metrics available from this date)
          </span>
        </p>
      </div>

      {/* User Metrics */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">User Metrics</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Registered Users" value={metrics.users.total} />
          <MetricCard label="New Users (7d)" value={metrics.users.new7d} />
          <MetricCard label="New Users (30d)" value={metrics.users.new30d} />
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
            label="Engaged Users (7d)"
            value={metrics.users.engaged7d}
            note="Meaningful product actions"
            highlight
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

      {/* Feature Adoption */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Feature Adoption</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Gmail Connected"
            value={metrics.adoption.gmailConnected}
            subtitle={`${metrics.adoption.gmailConnectedPercent}% of users`}
          />
          <MetricCard
            label="Resume Match Users"
            value={metrics.adoption.resumeMatchUsers}
            subtitle={`${metrics.adoption.resumeMatchUsersPercent}% of users`}
          />
        </div>
      </section>

      {/* Activity */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Activity</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Total Applications"
            value={metrics.activity.totalApplications}
          />
          <MetricCard
            label="Applications (7d)"
            value={metrics.activity.applications7d}
          />
          <MetricCard
            label="Applications (30d)"
            value={metrics.activity.applications30d}
          />
          <MetricCard
            label="Total Gmail Syncs"
            value={metrics.activity.totalGmailSyncs}
          />
          <MetricCard label="Gmail Syncs (7d)" value={metrics.activity.gmailSyncs7d} />
          <MetricCard
            label="Gmail Syncs (30d)"
            value={metrics.activity.gmailSyncs30d}
          />
          <MetricCard
            label="Total Resume Analyses"
            value={metrics.activity.totalResumeAnalyses}
          />
          <MetricCard
            label="Resume Analyses (7d)"
            value={metrics.activity.resumeAnalyses7d}
          />
          <MetricCard
            label="Resume Analyses (30d)"
            value={metrics.activity.resumeAnalyses30d}
          />
          <MetricCard label="Total Resumes" value={metrics.activity.totalResumes} />
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

      {/* Signup Trend */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">
          Signup Trend (Last 30 Days)
        </h2>
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="px-4 py-6">
            <div className="flex h-48 items-end justify-between gap-1">
              {metrics.signupTrend.map((point) => {
                const maxCount = Math.max(...metrics.signupTrend.map((p) => p.count));
                const height = maxCount > 0 ? (point.count / maxCount) * 100 : 0;
                return (
                  <div
                    key={point.date}
                    className="group relative flex-1"
                    title={`${point.date}: ${point.count} signups`}
                  >
                    <div
                      className="w-full bg-accent transition-opacity group-hover:opacity-80"
                      style={{ height: `${height}%`, minHeight: point.count > 0 ? '2px' : '0' }}
                    />
                    <div className="absolute -bottom-6 left-0 right-0 text-center text-xs text-text-muted">
                      {point.count > 0 ? point.count : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 flex justify-between text-xs text-text-secondary">
              <span>{metrics.signupTrend[0]?.date}</span>
              <span>{metrics.signupTrend[metrics.signupTrend.length - 1]?.date}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-text-muted">
        Last updated: {new Date(metrics.generatedAt).toLocaleString()}
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  subtitle?: string;
  note?: string;
  highlight?: boolean;
}

function MetricCard({ label, value, subtitle, note, highlight }: MetricCardProps) {
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
      {subtitle && <div className="mt-1 text-sm text-text-muted">{subtitle}</div>}
      {note && (
        <div className="mt-1 text-xs text-text-muted italic">({note})</div>
      )}
    </div>
  );
}

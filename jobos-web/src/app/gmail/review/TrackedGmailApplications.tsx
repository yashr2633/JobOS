"use client";

import type { Application } from "@/app/applications/types";
import { useMergedApplications } from "@/lib/gmail/useMergedApplications";
import { buildGmailMessageUrl } from "@/lib/gmail/sourceLink";

export default function TrackedGmailApplications({ serverApplications }: { serverApplications: Application[] | null }) {
  const { applications, loading, error } = useMergedApplications(serverApplications ?? []);
  const gmail = applications.filter(application => !!application.gmailMessageId);
  return <section className="product-panel">
    <h2>Tracked Gmail applications</h2>
    {serverApplications === null && <p role="alert" className="product-notice product-error mt-5">Server applications could not load. Browser scan results remain available below.</p>}
    {error && <p role="alert" className="product-notice product-error mt-5">Browser scan results could not load. Please retry.</p>}
    {loading ? <p role="status" className="mt-5 text-sm text-text-muted">Loading your Gmail scan results…</p> : <div className="product-list mt-5">
      {gmail.map(application => {
        const url = buildGmailMessageUrl(application.gmailMessageId, application.gmailAddress);
        return <article className="product-list-row" key={application.id}>
          <div><strong>{application.company}</strong><p>{application.role}</p><span className="product-badge mt-3">{application.status}</span></div>
          {url && <div><a href={url} target="_blank" rel="noopener noreferrer" className="product-button">Open source email ↗</a>{!application.gmailAddress && <p className="mt-2 text-xs text-text-muted">Open in the Gmail account you scanned.</p>}</div>}
        </article>;
      })}
      {!gmail.length && !error && <div className="product-empty">No Gmail-linked applications are available yet. Run a scan from your dashboard.</div>}
    </div>}
  </section>;
}

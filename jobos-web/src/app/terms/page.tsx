import type { Metadata } from "next";
import Link from "next/link";

/**
 * Public Terms of Service.
 *
 * Public by default (not listed in the middleware's protected prefixes) and
 * deliberately not wrapped in AppShell, so anonymous visitors — including
 * Google's OAuth verification reviewers — can read it. Standard, concise terms
 * only; no claims of certification, compliance, or guarantees the project has
 * not verified.
 */
export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of JobTrackOS.",
};

const LAST_UPDATED = "August 25, 2026";

/** Official monitored support address (matches Google OAuth Branding). */
const SUPPORT_EMAIL = "kenilja946@gmail.com";

export default function TermsPage() {
  return (
    <main className="min-h-full bg-bg px-4 py-12 text-text sm:px-6">
      <article className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <Link
            href="/"
            className="text-sm font-medium text-accent hover:text-accent-hover"
          >
            ← Back to JobTrackOS
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            Terms of Service
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Know where your career stands.
          </p>
          <p className="mt-2 text-sm text-text-muted">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="space-y-8 text-sm leading-6 text-text-secondary">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              1. Acceptance of terms
            </h2>
            <p>
              By creating an account or using JobTrackOS, you agree to these
              Terms of Service. If you do not agree, please do not use the
              service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              2. Use of JobTrackOS
            </h2>
            <p>
              JobTrackOS helps you track job applications, organize job-related
              email activity, and tailor resumes. You agree to use the service
              only for lawful purposes and not to misuse, disrupt, or attempt to
              gain unauthorized access to it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              3. User accounts
            </h2>
            <p>
              You are responsible for the information you provide and for
              maintaining the confidentiality of your account credentials.
              Activity that occurs under your account is your responsibility.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              4. Gmail integration
            </h2>
            <p>
              Connecting Gmail is optional. If you connect it, you grant
              JobTrackOS read-only access used solely for user-initiated
              job-application tracking, as described in our{" "}
              <Link
                href="/privacy-policy"
                className="text-accent hover:text-accent-hover"
              >
                Privacy Policy
              </Link>
              . JobTrackOS does not send, delete, modify, move, label, or
              otherwise manage your Gmail messages. You may reset Gmail-derived
              tracking data separately from disconnecting Gmail. You can
              disconnect at any time from Integrations settings, and you may also
              revoke authorization directly through your Google Account.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              5. User responsibility
            </h2>
            <p>
              You are responsible for reviewing the application records and
              suggestions JobTrackOS produces. Automated organization and
              analysis are provided to assist you and may contain inaccuracies,
              so you should verify important information before relying on it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              6. Intellectual property
            </h2>
            <p>
              JobTrackOS, including its name, design, and software, is owned by
              its creators and is protected by applicable laws. You retain
              ownership of the content and data you provide. These terms do not
              grant you any right to JobTrackOS&apos;s branding or software
              beyond using the service as intended.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              7. Service availability
            </h2>
            <p>
              The service is provided on an &quot;as is&quot; and &quot;as
              available&quot; basis. We may change, suspend, or discontinue
              features at any time, and we do not guarantee that the service will
              be uninterrupted or error-free.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              8. Limitation of liability
            </h2>
            <p>
              To the maximum extent permitted by law, JobTrackOS and its creators
              are not liable for any indirect, incidental, or consequential
              damages, or for any loss of data, arising from your use of the
              service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              9. Termination
            </h2>
            <p>
              You may stop using JobTrackOS at any time. We may suspend or
              terminate access if these terms are violated or if necessary to
              protect the service or its users.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              10. Changes to terms
            </h2>
            <p>
              We may update these terms from time to time. Material changes will
              be reflected by updating the &quot;Last updated&quot; date above.
              Continued use of the service after changes take effect constitutes
              acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              11. Contact information
            </h2>
            {/* TODO: Replace SUPPORT_EMAIL with the official, monitored support
                mailbox you control before submitting for Google verification. */}
            <p>
              Questions about these terms? Contact us at{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-accent hover:text-accent-hover"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </section>

          <section className="border-t border-border pt-6">
            <p className="text-sm text-text-muted">
              See also our{" "}
              <Link
                href="/privacy-policy"
                className="text-accent hover:text-accent-hover"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

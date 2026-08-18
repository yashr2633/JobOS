import type { Metadata } from "next";
import Link from "next/link";

/**
 * Public Privacy Policy.
 *
 * Deliberately NOT wrapped in AppShell: it must render for anonymous visitors
 * (Google's OAuth verification reviewers included), so it composes its own
 * minimal public shell and pulls in no authenticated navigation. The route is
 * public by default — it is not listed in the middleware's protected prefixes.
 *
 * Every claim here is limited to what the project actually does: read-only
 * Gmail access for job tracking, storage in the app's managed backend, and the
 * ability to disconnect. It intentionally avoids asserting certifications,
 * encryption specifics, or retention periods that are not verified in the code.
 */
export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How JobTrackOS handles your account information and optional Gmail data.",
};

const LAST_UPDATED = "August 19, 2026";

/** Official monitored support address (matches Google OAuth Branding). */
const SUPPORT_EMAIL = "kenilja946@gmail.com";

export default function PrivacyPolicyPage() {
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
            Privacy Policy
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
            <h2 className="mb-2 text-lg font-semibold text-text">Overview</h2>
            <p>
              JobTrackOS helps you track job applications, organize job-related
              email activity, and tailor resumes. This policy explains what
              information JobTrackOS collects, how it is used, and the choices
              you have. By using JobTrackOS you agree to this policy.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              Information we collect
            </h2>
            <p>
              JobTrackOS collects the account information needed to provide the
              service, such as your email address and authentication details
              managed through our authentication provider. It also stores the
              job-application data you create or that is organized from a Gmail
              connection you choose to enable.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              Google / Gmail connection is optional
            </h2>
            <p>
              Connecting Gmail is entirely optional. JobTrackOS works without it,
              and you can use the product to track applications you add
              yourself. You are only asked to connect Gmail if you choose to have
              JobTrackOS help find and organize job-related email.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              How we use Gmail data
            </h2>
            <p>
              When you connect Gmail, JobTrackOS requests{" "}
              <span className="font-medium text-text">read-only</span> access and
              uses it solely for the application&apos;s job-tracking
              functionality: identifying job-related messages and organizing them
              into application records for you. Specifically:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Gmail data is accessed only to provide job-tracking features.</li>
              <li>Gmail data is never sold.</li>
              <li>Gmail data is never used for advertising.</li>
              <li>
                JobTrackOS does not send, delete, or modify email on your behalf.
              </li>
              <li>
                JobTrackOS&apos;s use of information received from Google APIs
                adheres to the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  className="text-accent hover:text-accent-hover"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              Disconnecting and revoking access
            </h2>
            <p>
              You can disconnect Gmail at any time from the Integrations settings
              in JobTrackOS, which stops further access and clears the stored
              connection credentials. You can also review and revoke
              JobTrackOS&apos;s access directly from your Google Account security
              settings at{" "}
              <a
                href="https://myaccount.google.com/permissions"
                className="text-accent hover:text-accent-hover"
                target="_blank"
                rel="noreferrer"
              >
                myaccount.google.com/permissions
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              Data storage and security
            </h2>
            <p>
              Your data is stored using a managed backend platform that provides
              JobTrackOS&apos;s database and authentication. Access to your
              records is scoped to your account. Gmail authorization tokens are
              handled by server-side code and are not exposed to the browser. No
              method of storage or transmission is perfectly secure, so we cannot
              guarantee absolute security, but access is limited to what the
              service requires to function.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              Data sharing
            </h2>
            <p>
              JobTrackOS does not sell your personal information. Data is
              processed by the infrastructure providers that operate the service
              (for example, hosting, database/authentication, and the AI provider
              used to analyze job-related text you submit) only to the extent
              needed to deliver the features you use.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">Your choices</h2>
            <p>
              You can add or remove application data, disconnect Gmail, and stop
              using the service at any time. If you would like help with your
              data, contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">
              Changes to this policy
            </h2>
            <p>
              We may update this policy from time to time. Material changes will
              be reflected by updating the &quot;Last updated&quot; date above.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text">Contact</h2>
            {/* TODO: Replace SUPPORT_EMAIL with the official, monitored support
                mailbox you control before submitting for Google verification. */}
            <p>
              Questions about this policy? Contact us at{" "}
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
                href="/terms"
                className="text-accent hover:text-accent-hover"
              >
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

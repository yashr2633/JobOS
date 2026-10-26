/**
 * Auth layout — login and signup.
 *
 * `min-h-dvh` rather than `min-h-screen`: on mobile browsers `100vh` includes the
 * collapsing address bar, so a centred card sits slightly below the fold and the
 * page scrolls for no reason. The dynamic viewport unit measures what is actually
 * visible.
 *
 * `py-8` gives the card breathing room at short heights (a landscape phone)
 * instead of clipping it against the viewport edges.
 */
import Brand from "../components/Brand";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-product-shell">
      <header className="auth-product-header"><Brand /><Link href="/employer/login">Hiring? <strong>Employer login</strong></Link></header>
      <div className="auth-product-content">{children}</div>
      <footer className="auth-product-footer"><span>© {new Date().getFullYear()} JobTrackOS</span><div className="flex gap-4"><Link href="/privacy-policy">Privacy</Link><Link href="/terms">Terms</Link><a href="mailto:support@jobtrackos.online">Contact</a></div></footer>
    </div>
  );
}

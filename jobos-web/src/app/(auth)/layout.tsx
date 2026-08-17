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
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

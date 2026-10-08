import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT, ThemeProvider } from "./components/theme";
import { GmailTokenProvider } from "@/lib/gmail/GmailTokenProvider";
import { HOME_TITLE, HOME_DESCRIPTION, PRIVATE_ROBOTS, SITE_ORIGIN } from "@/lib/seo/metadata";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  // "JobTrackOS" is one word in the wordmark but reads as "Job Track O-S".
  title: {
    default: HOME_TITLE,
    template: "%s · JobTrackOS",
  },
  applicationName: "JobTrackOS",
  verification: {
    google: "u1gIp8A23DWVeW47dbsKaoFSsMXwIGvH9LyRQcEFSPw",
  },
  description: HOME_DESCRIPTION,
  // Default closed to indexing; only the public marketing/legal pages opt in.
  robots: PRIVATE_ROBOTS,
};

/**
 * Viewport configuration for a genuinely mobile-capable layout.
 *
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to real
 * values on notched devices, which the bottom navigation depends on.
 *
 * `maximumScale` and `userScalable` are deliberately left at their defaults:
 * blocking pinch-zoom is a common "app-like" tweak and an accessibility
 * regression, so it is not done here.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below sets data-theme before paint; React must not
      // treat that as a hydration mismatch.
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored theme during the first style resolution, so there
            is no flash of the wrong theme before hydration. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <GmailTokenProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </GmailTokenProvider>
      </body>
    </html>
  );
}

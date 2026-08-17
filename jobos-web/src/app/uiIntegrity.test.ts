/**
 * UI integrity tests.
 *
 * Source-level assertions, in the style of `lib/gmail/security.test.ts`. They
 * hold the invariants this polish pass established, which no unit test on a pure
 * function can express and which a later edit could silently undo:
 *
 *  - no component reintroduces a hardcoded Tailwind palette class (the defect
 *    that made light mode unreadable in a dozen places);
 *  - every primary destination is reachable on mobile as well as desktop;
 *  - the app shell is defined once, not per page;
 *  - fixed mobile navigation cannot cover page content;
 *  - the Gmail source link and the resume export contract survive.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), "src", "app");

function read(relativeToSrc: string): string {
  return readFileSync(join(process.cwd(), "src", relativeToSrc), "utf8");
}

/**
 * Source with comments removed.
 *
 * Needed for "this code never does X" assertions: several modules DESCRIBE what
 * they deliberately avoid ("never written to localStorage"), and matching raw
 * text would flag the documentation that proves the guarantee.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Every .tsx under src/app. */
function componentFiles(dir = APP_DIR, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      componentFiles(full, found);
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Design-token discipline
// ---------------------------------------------------------------------------

/**
 * Palette families that must not appear as literal utility classes.
 *
 * A class like `text-slate-400` is fixed to one lightness, so it cannot be
 * correct in both themes — that is precisely how `text-slate-300` ended up
 * invisible on a white card. Semantic tokens carry a value per theme.
 */
const PALETTE_PATTERN =
  /(?:bg|text|border|ring|divide|from|to|via|placeholder:text|hover:bg|hover:text|hover:border|focus:border)-(?:slate|gray|zinc|neutral|stone|blue|indigo|violet|purple|fuchsia|pink|rose|emerald|green|teal|cyan|sky|lime|amber|yellow|orange|red)-\d{2,3}/g;

test("no component uses a hardcoded Tailwind palette class", () => {
  const offenders: string[] = [];

  for (const file of componentFiles()) {
    const source = readFileSync(file, "utf8");
    const matches = source.match(PALETTE_PATTERN);
    if (matches) {
      const relative = file.replace(join(process.cwd(), "src") + "\\", "").replace(/\\/g, "/");
      offenders.push(`${relative}: ${[...new Set(matches)].join(", ")}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Use semantic tokens (bg-surface, text-text-secondary, ...) instead:\n${offenders.join("\n")}`
  );
});

/**
 * The bare `placeholder-<colour>` form, which the older Tailwind syntax allows.
 *
 * Caught separately because it does not carry the `text-` segment the pattern
 * above looks for — which is exactly how `placeholder-slate-500` survived the
 * first migration pass unnoticed.
 */
test("no component uses a bare placeholder- palette class", () => {
  const offenders: string[] = [];

  for (const file of componentFiles()) {
    const matches = readFileSync(file, "utf8").match(
      /placeholder-(?:slate|gray|zinc|neutral|stone|blue|red|green|amber|yellow)-\d{2,3}/g
    );
    if (matches) {
      const relative = file.replace(join(process.cwd(), "src") + "\\", "").replace(/\\/g, "/");
      offenders.push(`${relative}: ${[...new Set(matches)].join(", ")}`);
    }
  }

  assert.deepEqual(offenders, [], `Use placeholder:text-text-muted:\n${offenders.join("\n")}`);
});

/**
 * Body-text colour on a filled accent surface.
 *
 * `--accent` is a dark indigo in the light theme, so `text-text` (near-black) on
 * it fails contrast. Filled accent surfaces must use `text-accent-fg`. This
 * regressed once already: a mechanical `text-white` -> `text-text` rewrite hit
 * every primary button in the app.
 */
test("filled accent surfaces use the accent foreground, not body text", () => {
  const offenders: string[] = [];

  for (const file of componentFiles()) {
    const source = readFileSync(file, "utf8");
    // Inspect each className string independently, so unrelated classes on
    // neighbouring elements cannot look like a pair.
    for (const attr of source.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? []) {
      // Each quoted string inside the expression is applied as a unit, so a
      // conditional's branches must be judged separately. Flattening the whole
      // template literal would pair `bg-accent` from the selected branch with
      // `hover:text-text` from the unselected one and report a bug that is not
      // there.
      const segments = attr.match(/"[^"]*"/g) ?? [attr];

      for (const segment of segments) {
        // Only a FULLY OPAQUE accent background is a contrast problem. A
        // translucent tint (`bg-accent/10`) sits over the page surface, so body
        // text on it is correct — excluding "/" distinguishes the two.
        const hasFilledAccent = /\bbg-accent(?:-hover)?(?![\w\-/])/.test(segment);
        const hasBodyText = /\btext-text(?![\w-])/.test(segment);
        if (hasFilledAccent && hasBodyText) {
          const relative = file
            .replace(join(process.cwd(), "src") + "\\", "")
            .replace(/\\/g, "/");
          offenders.push(`${relative}: ${segment.slice(0, 120)}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Use text-accent-fg on a filled accent surface:\n${offenders.join("\n")}`
  );
});

test("both themes define every semantic token", () => {
  const css = read("app/globals.css");

  const tokens = [
    "--bg", "--surface", "--surface-2", "--border", "--border-strong",
    "--text", "--text-secondary", "--text-muted",
    "--accent", "--accent-hover", "--accent-fg",
    "--success", "--success-bg", "--warning", "--warning-bg",
    "--danger", "--danger-bg", "--focus",
  ];

  // The explicit dark block, which the theme toggle switches to.
  const darkBlock = css.slice(css.indexOf('[data-theme="dark"]'));
  assert.ok(darkBlock.length > 0, "an explicit dark theme block exists");

  for (const token of tokens) {
    assert.ok(
      css.includes(`${token}:`),
      `${token} is defined for the light theme`
    );
    assert.ok(
      darkBlock.includes(`${token}:`),
      `${token} is defined for the explicit dark theme`
    );
  }
});

test("dark mode is a designed theme, not an inversion", () => {
  const css = read("app/globals.css");
  // A real per-theme value, rather than a filter trick.
  assert.doesNotMatch(css, /filter:\s*invert/i);
  assert.match(css, /color-scheme:\s*dark/, "native controls follow the theme");
});

// ---------------------------------------------------------------------------
// Navigation reachability
// ---------------------------------------------------------------------------

test("desktop and mobile navigation are generated from one list", () => {
  const sidebar = read("app/components/Sidebar.tsx");
  const mobile = read("app/components/MobileNav.tsx");

  for (const source of [sidebar, mobile]) {
    assert.match(source, /NAV_ITEMS/, "reads the shared destination list");
    assert.match(source, /isNavItemActive/, "shares the active-route rule");
  }

  // Neither may hardcode its own hrefs, which is how a destination goes missing
  // from one bar.
  assert.doesNotMatch(sidebar, /href="\/applications"/);
  assert.doesNotMatch(mobile, /href="\/applications"/);
});

test("every primary destination is a real route", () => {
  const navSource = read("app/components/navItems.tsx");
  const hrefs = [...navSource.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);

  assert.ok(hrefs.length >= 4, "there are primary destinations");

  for (const href of hrefs) {
    if (href === "/") {
      assert.ok(statSync(join(APP_DIR, "page.tsx")).isFile());
      continue;
    }
    const segments = href.replace(/^\//, "").split("/");
    const pagePath = join(APP_DIR, ...segments, "page.tsx");
    assert.doesNotThrow(
      () => statSync(pagePath),
      `${href} has no page.tsx — the destination would 404`
    );
  }
});

test("the mobile bar is hidden on desktop and the rail on mobile", () => {
  assert.match(read("app/components/MobileNav.tsx"), /md:hidden/);
  assert.match(read("app/components/Sidebar.tsx"), /hidden .*md:flex|md:flex/);
});

// ---------------------------------------------------------------------------
// App shell consolidation
// ---------------------------------------------------------------------------

test("pages compose the shared AppShell rather than their own shell", () => {
  const pages = componentFiles().filter((file) => file.endsWith("page.tsx"));

  for (const file of pages) {
    const source = readFileSync(file, "utf8");
    const relative = file.replace(join(process.cwd(), "src") + "\\", "").replace(/\\/g, "/");

    // Only AppShell itself may compose these two directly.
    assert.doesNotMatch(
      source,
      /<Sidebar\s*\/>/,
      `${relative} should render AppShell, not Sidebar directly`
    );
    assert.doesNotMatch(
      source,
      /<Navbar\s*\/>/,
      `${relative} should render AppShell, not Navbar directly`
    );
  }
});

test("only AppShell composes the navigation primitives", () => {
  const shell = read("app/components/AppShell.tsx");
  assert.match(shell, /<Sidebar \/>/);
  assert.match(shell, /<MobileNav \/>/);
  assert.match(shell, /<Navbar \/>/);
});

// ---------------------------------------------------------------------------
// Mobile layout correctness
// ---------------------------------------------------------------------------

test("fixed bottom navigation cannot cover page content", () => {
  const shell = read("app/components/AppShell.tsx");
  const css = read("app/globals.css");

  // The shell reserves the bar's height...
  assert.match(shell, /pb-mobile-nav/);
  // ...and that reservation includes the safe-area inset.
  assert.match(css, /\.pb-mobile-nav\s*\{[^}]*safe-area-inset-bottom/);
  // The bar itself pads for the home indicator.
  assert.match(read("app/components/MobileNav.tsx"), /pb-safe/);
  assert.match(css, /\.pb-safe\s*\{[^}]*safe-area-inset-bottom/);
});

test("safe-area insets are actually available to CSS", () => {
  // Without viewportFit: "cover", every env(safe-area-inset-*) resolves to 0.
  assert.match(read("app/layout.tsx"), /viewportFit:\s*"cover"/);
});

test("pinch-zoom is not disabled", () => {
  // Comments stripped: the layout DOCUMENTS that it deliberately leaves these
  // defaults alone, and that prose would otherwise match.
  const code = codeOnly(read("app/layout.tsx"));
  assert.doesNotMatch(code, /maximumScale/);
  assert.doesNotMatch(code, /userScalable/);
});

test("the shell prevents horizontal overflow", () => {
  const shell = read("app/components/AppShell.tsx");
  // A flex child will not shrink below its intrinsic content width without this.
  assert.match(shell, /min-w-0/);
  assert.match(read("app/globals.css"), /overflow-x:\s*hidden/);
});

test("the theme is applied before first paint", () => {
  // Otherwise a dark-theme user sees a white flash on every navigation.
  assert.match(read("app/components/theme.tsx"), /THEME_INIT_SCRIPT/);
  assert.match(read("app/layout.tsx"), /THEME_INIT_SCRIPT/);
});

// ---------------------------------------------------------------------------
// Accessibility basics
// ---------------------------------------------------------------------------

test("the shell offers a skip link and a labelled main region", () => {
  const shell = read("app/components/AppShell.tsx");
  assert.match(shell, /Skip to content/);
  assert.match(shell, /id="main-content"/);
  assert.match(shell, /href="#main-content"/);
});

test("navigation regions are labelled and mark the current page", () => {
  for (const path of ["app/components/Sidebar.tsx", "app/components/MobileNav.tsx"]) {
    const source = read(path);
    assert.match(source, /aria-label="Primary"/, `${path} labels its nav`);
    assert.match(source, /aria-current=\{.*"page"/, `${path} marks the current page`);
  }
});

test("the theme control is a real radio group", () => {
  const source = read("app/components/theme.tsx");
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /role="radio"/);
  assert.match(source, /aria-checked=\{selected\}/);
});

test("a single focus ring is defined globally", () => {
  assert.match(read("app/globals.css"), /:focus-visible\s*\{[^}]*outline/);
});

test("reduced motion is respected", () => {
  assert.match(read("app/globals.css"), /prefers-reduced-motion:\s*reduce/);
});

// ---------------------------------------------------------------------------
// Protected functionality (regression guards)
// ---------------------------------------------------------------------------

test("the Gmail source link still targets the connected account and exact message", () => {
  const modal = read("app/applications/components/ViewApplicationModal.tsx");

  assert.match(modal, /buildGmailMessageUrl\(/, "uses the shared builder");
  assert.match(modal, /application\.gmailMessageId/, "uses the stored message id");
  assert.match(modal, /application\.gmailAddress/, "targets the connected account");
  // The section is gated on a usable URL, so a non-Gmail application shows no link.
  assert.match(modal, /\{gmailSourceUrl && \(/);

  const builder = read("lib/gmail/sourceLink.ts");
  assert.match(builder, /authuser=/, "pins the account explicitly");
  assert.match(builder, /#all\//, "opens the exact message");
});

test("the resume export still renders the edited draft server-side", () => {
  const panel = read("app/resume-match/components/TailorResumePanel.tsx");
  assert.match(panel, /content: draft/, "posts the edited draft");
  assert.match(panel, /parseResumeDocument\(draft\)/, "previews the same draft");
  assert.match(panel, /text\/plain;charset=utf-8/, "TXT export still works");

  const route = read("app/api/resumes/export/route.ts");
  assert.match(route, /getApplicationIntelligenceInput\(/, "ownership is verified");
  assert.match(route, /if \(!user\) return err\("Unauthorized\.", 401\)/);
});

test("settings routes are covered by the auth guard", () => {
  const middleware = read("lib/supabase/middleware.ts");
  assert.match(middleware, /"\/settings"/, "the /settings prefix is protected");
  // The layout re-checks, so a section page cannot render anonymously.
  assert.match(read("app/settings/layout.tsx"), /redirect\("\/login/);
});

test("no settings page exposes a credential or token", () => {
  const settingsDir = join(APP_DIR, "settings");
  for (const file of componentFiles(settingsDir)) {
    const code = codeOnly(readFileSync(file, "utf8"));
    const relative = file.replace(join(process.cwd(), "src") + "\\", "").replace(/\\/g, "/");

    assert.doesNotMatch(code, /access_token|refresh_token/, relative);
    assert.doesNotMatch(code, /CLIENT_SECRET/i, relative);
    // A password is only ever handed to the provider, never stored locally.
    assert.doesNotMatch(code, /localStorage\.setItem\([^)]*password/i, relative);
  }
});

test("the password change goes only through the auth provider", () => {
  const form = read("app/settings/components/PasswordForm.tsx");
  const code = codeOnly(form);

  assert.match(code, /supabase\.auth\.updateUser\(\{\s*password/);
  assert.match(code, /autoComplete="new-password"/);
  // No custom credential handling of any kind.
  assert.doesNotMatch(code, /bcrypt|sha256|createHash|hashPassword/i);
  // Asserted against code, not prose: the module's own comment documents this
  // guarantee and would otherwise match.
  assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie/);
});

test("the profile is stored via the provider, introducing no new table", () => {
  const profileForm = read("app/settings/components/ProfileForm.tsx");
  assert.match(profileForm, /supabase\.auth\.updateUser\(\{\s*data:/);
  // No direct table write, so no migration and no second source of truth.
  assert.doesNotMatch(profileForm, /\.from\("profiles"\)/);
  assert.doesNotMatch(profileForm, /\.from\(/);
});

// ---------------------------------------------------------------------------
// Reset: server-side authorization for a destructive action
// ---------------------------------------------------------------------------

test("the reset route derives the user from the session, never the request", () => {
  const route = read("app/api/gmail/reset/route.ts");
  const code = codeOnly(route);

  assert.match(code, /supabase\.auth\.getUser\(\)/, "reads the session");
  // The shared Gmail-route guard idiom, also asserted by gmail/security.test.ts.
  assert.match(code, /if \(authError \|\| !user\) return err\(/);
  // The acting user must never come from client-supplied data. If any of these
  // appear, a caller could nominate whose data to delete.
  assert.doesNotMatch(code, /body\s*\)\s*\.userId/);
  assert.doesNotMatch(code, /userId\s*[:=]\s*(?:body|params|searchParams)/);
  assert.doesNotMatch(code, /request\.headers\.get\(["']x-user/i);
});

test("the reset requires an explicit confirmation token", () => {
  const code = codeOnly(read("app/api/gmail/reset/route.ts"));
  assert.match(code, /confirm !== RESET_CONFIRMATION/);
});

test("the reset deletes only Gmail-origin applications", () => {
  const code = codeOnly(read("lib/api/applicationReset.ts"));

  // The delete is scoped by BOTH user and source.
  assert.match(code, /\.from\("applications"\)[\s\S]*?\.delete\(\)/);
  assert.match(code, /\.eq\("source", GMAIL_SOURCE\)/);
  // And never by the manual source, which would delete the user's own records.
  assert.doesNotMatch(code, /\.eq\("source", MANUAL_SOURCE\)[\s\S]{0,80}delete/);
});

test("every reset statement is scoped to the acting user", () => {
  const code = codeOnly(read("lib/api/applicationReset.ts"));

  // Each mutation must carry a user_id filter. Count them against the mutations.
  const mutations = (code.match(/\.(?:delete|update)\(/g) ?? []).length;
  const userScopes = (code.match(/\.eq\("user_id", userId\)/g) ?? []).length;

  assert.ok(mutations > 0, "there are mutations to check");
  assert.ok(
    userScopes >= mutations,
    `every mutation is user-scoped (${mutations} mutations, ${userScopes} scopes)`
  );
});

test("the reset never disconnects Gmail or clears credentials", () => {
  const code = codeOnly(read("lib/api/applicationReset.ts"));

  // It updates the connection to clear sync state, but must not touch tokens or
  // the active flag — that would be a disconnect, not a reset.
  assert.doesNotMatch(code, /access_token/);
  assert.doesNotMatch(code, /refresh_token/);
  assert.doesNotMatch(code, /is_active/);
  // The connection row itself is never deleted.
  assert.doesNotMatch(code, /from\("gmail_connections"\)[\s\S]{0,120}\.delete\(\)/);
  // The anchor IS cleared, so the next scan is a full scan.
  assert.match(code, /history_id: null/);
});

test("both Gmail insert paths stamp the Gmail origin", () => {
  // Without this the reset cannot find what it must delete.
  assert.match(read("lib/gmail/autoImport.ts"), /source: "gmail"/);
  assert.match(read("app/api/gmail/sync/import/route.ts"), /source: "gmail"/);
});

test("the manual insert paths stamp the manual origin", () => {
  // Without this a manual application would inherit the column default; the
  // default is 'manual' too, but stating it makes the intent explicit and
  // survives a future default change.
  const applications = read("lib/api/applications.ts");
  const stamps = (applications.match(/source: "manual"/g) ?? []).length;
  assert.ok(stamps >= 2, `both manual insert paths are stamped (found ${stamps})`);
});

test("the reset migration is additive and re-runnable", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase-schema-sprint12-application-source.sql"),
    "utf8"
  );

  assert.match(sql, /ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(sql, /CHECK \(source IN \('manual', 'gmail'\)\)/);
  // Safe default: an unknown origin is never eligible for deletion.
  assert.match(sql, /DEFAULT 'manual'/);
  // Additive only.
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /DROP\s+POLICY/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  // It must not touch Gmail or resume table definitions.
  assert.doesNotMatch(sql, /ALTER TABLE public\.gmail_/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.resumes/);
});

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

test("no user-visible string carries the old product name", () => {
  const offenders: string[] = [];

  for (const file of componentFiles()) {
    const source = readFileSync(file, "utf8");
    // Case-sensitive: the lowercase "jobos-theme" storage key is intentionally
    // preserved, because renaming it would reset every user's saved theme.
    if (/JobOS(?!\w)/.test(source.replace(/JobTrackOS/g, ""))) {
      offenders.push(
        file.replace(join(process.cwd(), "src") + "\\", "").replace(/\\/g, "/")
      );
    }
  }

  assert.deepEqual(offenders, [], `Rebrand to JobTrackOS:\n${offenders.join("\n")}`);
});

test("the document metadata carries the brand and the tagline", () => {
  const layout = read("app/layout.tsx");

  assert.match(layout, /JobTrackOS/, "the wordmark is present");
  assert.match(layout, /Know where your career stands\./, "the tagline is present");
  assert.match(layout, /applicationName: "JobTrackOS"/);
});

test("the app shell shows the brand on both desktop and mobile", () => {
  // The rail carries it on desktop; the top bar carries it on mobile, where the
  // rail is hidden. Missing either leaves a viewport with no product identity.
  assert.match(read("app/components/Sidebar.tsx"), /JobTrackOS/);
  assert.match(read("app/components/Navbar.tsx"), /JobTrackOS/);
});

test("the auth screens carry the brand and the tagline", () => {
  assert.match(read("app/(auth)/signup/page.tsx"), /JobTrackOS/);
  assert.match(
    read("app/(auth)/signup/page.tsx"),
    /Know where your career stands\./
  );
  assert.match(read("app/(auth)/login/LoginForm.tsx"), /JobTrackOS/);
});

test("the internal theme storage key is deliberately unchanged", () => {
  // Renaming it would silently reset every existing user's theme preference.
  assert.match(read("app/components/theme.tsx"), /"jobos-theme"/);
});

// ---------------------------------------------------------------------------
// Dashboard -> Gmail tracking shortcut
// ---------------------------------------------------------------------------

test("the dashboard shortcut targets the existing tracking section", () => {
  const page = read("app/page.tsx");

  assert.match(page, /href="#gmail-tracking"/, "the shortcut is an anchor");
  assert.match(page, /id="gmail-tracking"/, "the target exists on the same page");
  // Exactly one target, or the anchor is ambiguous.
  assert.equal(
    (page.match(/id="gmail-tracking"/g) ?? []).length,
    1,
    "exactly one anchor target"
  );
});

test("the shortcut does not duplicate the scanner", () => {
  const page = read("app/page.tsx");
  // One scan module on the page. A second would be a competing tracker.
  assert.equal(
    (page.match(/<GmailScanModule/g) ?? []).length,
    1,
    "the Gmail scan module is rendered exactly once"
  );
});

test("the shortcut label reflects connection state", () => {
  const page = read("app/page.tsx");
  // A user without Gmail cannot "track applications" yet, so the label must not
  // promise it.
  assert.match(page, /gmailConnected \? "Track My Applications" : "Connect Gmail"/);
});

test("the anchor target clears the sticky header", () => {
  // Without scroll-margin the heading lands underneath the sticky top bar.
  assert.match(read("app/page.tsx"), /id="gmail-tracking" className="[^"]*scroll-mt-/);
});

test("smooth scrolling is enabled and reduced-motion overrides it", () => {
  const css = read("app/globals.css");
  assert.match(css, /html\s*\{[^}]*scroll-behavior:\s*smooth/);
  // The reduced-motion block must include `html`, or its override cannot reach
  // the rule above.
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*html,/);
});

// ---------------------------------------------------------------------------
// Activity chart wiring
// ---------------------------------------------------------------------------

test("the dashboard renders the range-aware chart, not the fixed weekly one", () => {
  const page = read("app/page.tsx");

  assert.match(page, /<ActivityChart/);
  assert.match(page, /activity=\{report\.activity\}/, "fed by the window report");
  // The superseded component must not be reachable.
  assert.doesNotMatch(page, /WeeklyProgressChart/);
});

test("the chart never hardcodes a value", () => {
  const chart = codeOnly(read("app/dashboard/components/ActivityChart.tsx"));

  // The specific symptom reported was a bar showing 100.
  assert.doesNotMatch(chart, /=\s*100\b/, "no hardcoded 100");
  assert.doesNotMatch(chart, /Math\.max\(heightPercent/, "no minimum bar height");
  // Height comes from the real count over the real peak.
  assert.match(chart, /bucket\.count \/ peak/);
});

test("the chart names its real granularity", () => {
  const chart = read("app/dashboard/components/ActivityChart.tsx");
  // It must not claim to be weekly while showing days.
  assert.match(chart, /granularity === "day" \? "per day" : "per week"/);
  // Comments stripped: the module DOCUMENTS that it replaced the old
  // "Weekly applications" chart, and that prose would otherwise match.
  assert.doesNotMatch(codeOnly(chart), /Weekly applications/);
});

// ---------------------------------------------------------------------------
// OTP authentication
// ---------------------------------------------------------------------------

test("OTP uses Supabase Auth, with no second auth system", () => {
  const login = codeOnly(read("app/(auth)/login/LoginForm.tsx"));
  const signup = codeOnly(read("app/(auth)/signup/page.tsx"));

  assert.match(login, /supabase\.auth\.signInWithOtp\(/);
  assert.match(login, /supabase\.auth\.verifyOtp\(/);
  assert.match(signup, /supabase\.auth\.verifyOtp\(/);

  // No home-grown code generation, storage, or comparison anywhere.
  for (const source of [login, signup, codeOnly(read("lib/account/otp.ts"))]) {
    assert.doesNotMatch(source, /Math\.random/, "codes are never generated locally");
    assert.doesNotMatch(source, /localStorage|sessionStorage/, "codes are never stored");
    assert.doesNotMatch(source, /crypto\.randomUUID/);
  }
});

test("code sign-in for an existing account cannot silently create an account", () => {
  const login = codeOnly(read("app/(auth)/login/LoginForm.tsx"));
  // This preserves email-code login for existing Google-created accounts while
  // preventing an unrecognised address from becoming a new account.
  assert.match(login, /signInWithOtp\(\{[\s\S]*?options: \{ shouldCreateUser: false \}/);
  assert.equal(
    (login.match(/signInWithOtp\(/g) ?? []).length,
    (login.match(/shouldCreateUser: false/g) ?? []).length,
    "every signInWithOtp call is guarded"
  );
  assert.match(login, /type: VERIFY_OTP_TYPE\.signin/);
});

test("password signup uses the confirmation-code flow without magic-link options", () => {
  const signup = codeOnly(read("app/(auth)/signup/page.tsx"));

  assert.match(
    signup,
    /supabase\.auth\.signUp\(\{\s*email: email\.trim\(\),\s*password,\s*\}\)/
  );
  assert.match(signup, /if \(!data\.session\)/);
  assert.match(signup, /setAwaitingCode\(true\)/);
  assert.match(signup, /type: VERIFY_OTP_TYPE\.signup/);
  assert.match(signup, /We could not send your confirmation code/);
  assert.doesNotMatch(signup, /emailRedirectTo/);
});

test("email-code login has no stale magic-link path", () => {
  const login = codeOnly(read("app/(auth)/login/LoginForm.tsx"));
  const codeFlow = login.slice(
    login.indexOf("async function requestSignInCode"),
    login.indexOf("async function handleGoogleLogin")
  );

  assert.doesNotMatch(codeFlow, /redirectTo|emailRedirectTo/);
  assert.doesNotMatch(login, /verification link/i);
  assert.match(login, /verification code/i);
  assert.match(codeFlow, /signInWithOtp\(/);
  assert.match(codeFlow, /verifyOtp\(/);
  // Google OAuth still intentionally owns the callback redirect elsewhere.
  assert.match(login, /signInWithOAuth\(/);
});

test("both auth flows share one code component", () => {
  // A second copy would let validation and cooldown behaviour drift apart.
  assert.match(read("app/(auth)/login/LoginForm.tsx"), /from "\.\.\/OtpStep"/);
  assert.match(read("app/(auth)/signup/page.tsx"), /from "\.\.\/OtpStep"/);
});

test("the code input is mobile- and password-manager-friendly", () => {
  const step = read("app/(auth)/OtpStep.tsx");
  assert.match(step, /inputMode="numeric"/, "a phone shows a number pad");
  assert.match(step, /autoComplete="one-time-code"/, "the OS can offer the code");
  assert.match(step, /maxLength=\{OTP_LENGTH\}/);
});

test("the code step offers resend with a visible cooldown and a way back", () => {
  const step = read("app/(auth)/OtpStep.tsx");
  assert.match(step, /Resend in \$\{remaining\}s/, "the wait is stated, not just disabled");
  assert.match(step, /onBack/, "the user can correct a mistyped email");
});

test("login offers password and code as two explicit methods", () => {
  const login = read("app/(auth)/login/LoginForm.tsx");
  assert.match(login, /role="tablist"/);
  assert.match(login, /label: "Password"/);
  assert.match(login, /label: "Login with code"/);
  assert.doesNotMatch(login, /label: "Email code"/);
});

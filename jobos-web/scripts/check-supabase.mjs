/**
 * Supabase connectivity / configuration check.
 *
 * Usage: node scripts/check-supabase.mjs
 *
 * Read-only and non-destructive: creates no users or rows, prints no secrets.
 * Reports whether the project is reachable, which auth providers are enabled,
 * and whether the `applications` table and its RLS policies are in place.
 */
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local"
  );
  process.exit(1);
}

const health = await fetch(`${url}/auth/v1/health`, {
  headers: { apikey: key },
});
console.log("Project reachable:", health.ok);

const settings = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key },
}).then((r) => r.json());
console.log("Email provider enabled:", settings.external?.email === true);
console.log("Google provider enabled:", settings.external?.google === true);
console.log("Signups enabled:", settings.disable_signup !== true);
console.log(
  "Email confirmation required:",
  settings.mailer_autoconfirm !== true
);

const table = await fetch(`${url}/rest/v1/applications?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const tableBody = await table.text();
const exists = table.status !== 404;
console.log("applications table exists:", exists);

if (exists) {
  console.log(
    "RLS blocks unauthenticated reads:",
    table.status === 200 && tableBody.trim() === "[]"
  );
} else {
  console.log("  -> Run supabase-schema.sql in the Supabase SQL Editor.");
}

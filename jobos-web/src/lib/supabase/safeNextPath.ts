/** Only same-origin paths can follow an authentication redirect. */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(raw)) return "/";
  try {
    const base = "https://jobtrackos.invalid";
    const url = new URL(raw, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

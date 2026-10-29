/** Next may use its bind address in request.url; the HTTP Host is the public authority. */
export function isDocumentRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const url = new URL(request.url);
    const authority = request.headers.get("host") ?? url.host;
    return new URL(`${url.protocol}//${authority}`).origin === origin;
  } catch { return false; }
}

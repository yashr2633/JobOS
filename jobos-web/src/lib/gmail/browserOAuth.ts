"use client";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleOAuth2 = {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): {
    requestAccessToken(config?: { prompt?: string }): void;
  };
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2;
      };
    };
  }
}

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`
    );

    const handleLoad = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        reject(new Error("Google Identity Services failed to initialize."));
      }
    };

    if (existing) {
      existing.addEventListener("load", handleLoad, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Could not load Google Identity Services.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Could not load Google Identity Services.")),
      { once: true }
    );

    document.head.appendChild(script);
  });
}

/**
 * Resolve the immutable Google account identifier (`sub`) for a browser-held
 * access token.
 *
 * CLIENT ONLY. The access token is sent ONLY to Google's own tokeninfo
 * endpoint — never to a JobTrackOS backend route. The single value returned is
 * the opaque `sub`, which is stable per Google account and never reused, so it
 * is the correct identity for "which Gmail account performed this scan".
 *
 * `sub` is returned for any access token and is not gated behind the
 * openid/profile/email scopes, so `gmail.readonly` alone is sufficient. No
 * email address is requested or returned here.
 *
 * Never log the token or the request URL.
 */
export async function resolveGoogleSubForAccessToken(
  accessToken: string
): Promise<string> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
      accessToken
    )}`,
    { method: "GET" }
  );

  if (!response.ok) {
    // Status only. The body can echo token material, so it is not surfaced.
    throw new Error(
      `Could not resolve the Google account for this token (status ${response.status}).`
    );
  }

  const info = (await response.json()) as { sub?: unknown };

  if (typeof info.sub !== "string" || info.sub.length === 0) {
    throw new Error("Google did not return an account identifier (sub).");
  }

  return info.sub;
}

export async function requestGmailBrowserAccessToken(): Promise<{
  accessToken: string;
  expiresIn: number;
  scope: string;
}> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();

  if (!clientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured.");
  }

  await loadGoogleIdentityServices();

  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;

    if (!oauth2) {
      reject(new Error("Google OAuth is unavailable."));
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,

      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                "Google did not return an access token."
            )
          );
          return;
        }

        resolve({
          accessToken: response.access_token,
          expiresIn: response.expires_in ?? 3600,
          scope: response.scope ?? GMAIL_SCOPE,
        });
      },

      error_callback: (error) => {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "Google authorization was cancelled."
              : "Google authorization popup failed."
          )
        );
      },
    });

    // Request access token
    // DO NOT force prompt: "consent" - let Google reuse previous consent
    // First-time users will see consent screen automatically
    // Returning users will get token immediately if consent was granted
    client.requestAccessToken();
  });
}

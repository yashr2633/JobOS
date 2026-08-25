/**
 * Gmail Token Provider - manages in-memory access token across navigation.
 *
 * CRITICAL SECURITY: Token is memory-only, never persisted to any storage.
 * 
 * This provider ensures the access token survives normal Next.js SPA navigation
 * between pages (Dashboard → Applications → Track My Jobs → Settings) without
 * requiring re-authorization for each page visit during the same session.
 *
 * Token lifecycle:
 * - User authorizes via Google Identity Services
 * - Token stored in React context (memory only)
 * - Survives SPA navigation (client-side routing)
 * - Cleared on page refresh/close (expected behavior)
 * - Never stored in IndexedDB, localStorage, sessionStorage, or cookies
 */

"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

interface GmailTokenContextValue {
  /** Current access token (memory-only) or null */
  accessToken: string | null;
  /** Set the current access token */
  setAccessToken: (token: string | null) => void;
  /** Clear the token (e.g., on logout or explicit disconnect) */
  clearToken: () => void;
}

const GmailTokenContext = createContext<GmailTokenContextValue | null>(null);

export function GmailTokenProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const clearToken = useCallback(() => {
    setAccessToken(null);
  }, []);

  return (
    <GmailTokenContext.Provider
      value={{
        accessToken,
        setAccessToken,
        clearToken,
      }}
    >
      {children}
    </GmailTokenContext.Provider>
  );
}

/**
 * Hook to access Gmail token from anywhere in the app.
 * 
 * Returns null if no token is currently in memory (user hasn't authorized yet
 * or token was cleared).
 */
export function useGmailToken(): GmailTokenContextValue {
  const context = useContext(GmailTokenContext);
  
  if (!context) {
    throw new Error("useGmailToken must be used within GmailTokenProvider");
  }
  
  return context;
}

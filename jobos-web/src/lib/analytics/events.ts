/**
 * Client-side analytics event tracking.
 *
 * Non-blocking, privacy-safe. Only tracks authenticated app sessions.
 * Server-side deduplication ensures one event per user per UTC day.
 */

import type { TrackEventRequest, TrackEventResponse } from '@/types/analytics';

/**
 * Track an authenticated session activity.
 *
 * Called on successful login and first authenticated page load per day.
 * Client-side debouncing prevents excessive requests; server enforces
 * deduplication via unique constraint.
 *
 * Non-blocking: failures are logged but never throw.
 *
 * @returns true if tracking succeeded, false otherwise
 */
export async function trackSessionActivity(): Promise<boolean> {
  // Client-side debounce: only attempt once per calendar day
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const storageKey = 'jobos_last_session_tracked';

  try {
    const lastTracked = localStorage.getItem(storageKey);
    if (lastTracked === today) {
      // Already tracked today (client-side), skip network call
      return true;
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) - proceed anyway
  }

  // Attempt to track
  const success = await trackEvent({
    event_name: 'user_session_activity',
    metadata: {
      session_date: today,
    },
  });

  if (success) {
    // Update local debounce marker
    try {
      localStorage.setItem(storageKey, today);
    } catch {
      // localStorage write failed - not critical
    }
  }

  return success;
}

/**
 * Track an analytics event via API.
 *
 * Non-blocking: catches all errors and logs them without throwing.
 * Server-side deduplication handles concurrent/duplicate requests safely.
 *
 * @param event - Event to track
 * @returns true if tracking succeeded, false otherwise
 */
async function trackEvent(event: TrackEventRequest): Promise<boolean> {
  try {
    const response = await fetch('/api/analytics/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      // Server returned error - log but don't throw
      console.warn('[analytics] Track event failed:', response.status);
      return false;
    }

    const result: TrackEventResponse = await response.json();
    return result.success;
  } catch (error) {
    // Network error, parse error, etc. - log but don't throw
    console.warn('[analytics] Track event error:', error);
    return false;
  }
}

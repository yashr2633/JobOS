"use client";

import { useEffect } from 'react';
import { trackSessionActivity } from '@/lib/analytics/events';

/**
 * Client-side session activity tracker.
 *
 * Tracks authenticated app sessions once per calendar day.
 * Non-blocking: failures are logged but never throw.
 */
export default function SessionTracker() {
  useEffect(() => {
    // Track session activity on mount (authenticated page load)
    void trackSessionActivity();
  }, []);

  // This component renders nothing
  return null;
}

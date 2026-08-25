/**
 * Browser-only IndexedDB persistence for Gmail-derived applications.
 *
 * CLIENT ONLY â€” runs entirely in the browser with NO backend calls.
 *
 * CRITICAL SECURITY PROPERTIES:
 * - Data stored in IndexedDB (NOT localStorage/sessionStorage/cookies)
 * - Partitioned by authenticated user ID (Supabase user.id)
 * - Raw Gmail bodies/snippets NOT stored
 * - NO transmission to Supabase/backend
 * - Deduplication by Gmail message ID
 */

import type { ApplicationStatus } from "@/app/applications/types";
import type { EmailCategory } from "./heuristics";
import type { EvidenceReason } from "./applicationEvidence";

/** Local Gmail-derived application stored in IndexedDB. */
export interface LocalGmailApplication {
  /** Local stable ID: `gmail-${userId}-${gmailMessageId}` */
  id: string;
  /** User ID from Supabase auth (for partitioning) */
  userId: string;
  /** Gmail message ID (for deduplication) */
  gmailMessageId: string;
  /** Gmail thread ID */
  gmailThreadId: string;
  /** Company name */
  company: string | null;
  /** Job title/role */
  role: string | null;
  /** Job URL if detected */
  jobUrl: string | null;
  /** Application date */
  appliedDate: string;
  /** Inferred status */
  status: ApplicationStatus;
  /** Email category */
  category: EmailCategory;
  /** Classification confidence */
  confidence: number;
  /** Evidence reason code */
  evidenceReason: EvidenceReason;
  /** True if lifecycle event */
  isLifecycle: boolean;
  /** Job portal/platform (LinkedIn, Naukri, Workday, etc.) or null for direct employer email */
  jobPortal: string | null;
  /** Source identifier (portal name or "Email" for direct, or "Gmail" as fallback) */
  source: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

/** Input for storing a classified Gmail application */
export interface StoreGmailApplicationInput {
  userId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  company: string | null;
  role: string | null;
  jobUrl: string | null;
  appliedDate: string;
  status: ApplicationStatus;
  category: EmailCategory;
  confidence: number;
  evidenceReason: EvidenceReason;
  isLifecycle: boolean;
  jobPortal: string | null;
}

/** Result of storing applications */
export interface StoreResult {
  added: number;
  updated: number;
  skipped: number;
}

const DB_NAME = "jobos-gmail-local";
const DB_VERSION = 2;
const STORE_NAME = "gmail-applications";
const INTEGRATION_STORE_NAME = "gmail-integration-state";

/**
 * Gmail integration state (non-sensitive metadata only).
 */
export interface GmailIntegrationState {
  userId: string;
  initialized: boolean;
  lastSuccessfulScanAt: string | null;
  lastScanWindow: string | null;
}

/**
 * Open the IndexedDB database.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create the applications object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        
        // Index by userId for efficient user-partitioned queries
        store.createIndex("userId", "userId", { unique: false });
        
        // Index by gmailMessageId for deduplication
        store.createIndex("gmailMessageId", "gmailMessageId", { unique: false });
        
        // Compound index for user + message lookup
        store.createIndex("userMessage", ["userId", "gmailMessageId"], {
          unique: true,
        });
        
        // Index by status for filtering
        store.createIndex("userStatus", ["userId", "status"], { unique: false });
      }

      // Create integration state store
      if (!db.objectStoreNames.contains(INTEGRATION_STORE_NAME)) {
        db.createObjectStore(INTEGRATION_STORE_NAME, { keyPath: "userId" });
      }
    };
  });
}

/**
 * Generate a stable local ID for a Gmail application.
 */
function makeLocalId(userId: string, gmailMessageId: string): string {
  return `gmail-${userId}-${gmailMessageId}`;
}

/**
 * Store multiple Gmail applications in IndexedDB.
 * 
 * Deduplicates by Gmail message ID - updates existing records rather than creating duplicates.
 */
export async function storeGmailApplications(
  inputs: StoreGmailApplicationInput[]
): Promise<StoreResult> {
  if (inputs.length === 0) {
    return { added: 0, updated: 0, skipped: 0 };
  }

  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("userMessage");

  let added = 0;
  let updated = 0;
  let skipped = 0;

  const now = new Date().toISOString();

  for (const input of inputs) {
    try {
      // Check if this Gmail message already exists for this user
      const existing = await new Promise<LocalGmailApplication | undefined>(
        (resolve, reject) => {
          const request = index.get([input.userId, input.gmailMessageId]);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }
      );

      const id = makeLocalId(input.userId, input.gmailMessageId);

      if (existing) {
        // Update existing record - preserve existing jobPortal and source if not updating
        const updatedRecord: LocalGmailApplication = {
          ...existing,
          company: input.company,
          role: input.role,
          jobUrl: input.jobUrl,
          appliedDate: input.appliedDate,
          status: input.status,
          category: input.category,
          confidence: input.confidence,
          evidenceReason: input.evidenceReason,
          isLifecycle: input.isLifecycle,
          jobPortal: input.jobPortal ?? existing.jobPortal ?? null,
          source: input.jobPortal ?? existing.jobPortal ?? "Email",
          updatedAt: now,
        };

        await new Promise<void>((resolve, reject) => {
          const request = store.put(updatedRecord);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });

        updated++;
      } else {
        // Create new record - derive source from jobPortal
        const source = input.jobPortal ?? "Email";
        
        const newRecord: LocalGmailApplication = {
          id,
          userId: input.userId,
          gmailMessageId: input.gmailMessageId,
          gmailThreadId: input.gmailThreadId,
          company: input.company,
          role: input.role,
          jobUrl: input.jobUrl,
          appliedDate: input.appliedDate,
          status: input.status,
          category: input.category,
          confidence: input.confidence,
          evidenceReason: input.evidenceReason,
          isLifecycle: input.isLifecycle,
          jobPortal: input.jobPortal,
          source,
          createdAt: now,
          updatedAt: now,
        };

        await new Promise<void>((resolve, reject) => {
          const request = store.add(newRecord);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });

        added++;
      }
    } catch (error) {
      // Skip records that fail
      skipped++;
    }
  }

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new Event("jobos:gmail-applications-changed")
    );
  }

  return { added, updated, skipped };
}

/**
 * Get all Gmail applications for a specific user.
 */
export async function getGmailApplicationsForUser(
  userId: string
): Promise<LocalGmailApplication[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("userId");

  const applications = await new Promise<LocalGmailApplication[]>(
    (resolve, reject) => {
      const request = index.getAll(userId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }
  );

  db.close();

  return applications;
}

/**
 * Get count of Gmail applications by status for a user.
 */
export async function getGmailApplicationCountsByStatus(
  userId: string
): Promise<Record<ApplicationStatus, number>> {
  const applications = await getGmailApplicationsForUser(userId);

  const counts: Record<ApplicationStatus, number> = {
    Applied: 0,
    Interview: 0,
    Offer: 0,
    Rejected: 0,
    Ghosted: 0,
  };

  for (const app of applications) {
    counts[app.status] = (counts[app.status] || 0) + 1;
  }

  return counts;
}

/**
 * Clear all Gmail applications for a specific user.
 */
export async function clearGmailApplicationsForUser(
  userId: string
): Promise<number> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("userId");

  // Get all keys for this user
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = index.getAllKeys(userId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  // Delete each record
  for (const key of keys) {
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();

  // Notify that applications changed
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new Event("jobos:gmail-applications-changed")
    );
  }

  return keys.length;
}

/**
 * Reset Gmail scan data - clears applications and scan state but preserves integration.
 * 
 * This allows a fresh rescan without disconnecting the Gmail integration.
 * Use this when you want to clear imported data and re-scan from scratch.
 */
export async function resetGmailScanData(
  userId: string
): Promise<{ applicationsCleared: number }> {
  // Clear all Gmail applications
  const applicationsCleared = await clearGmailApplicationsForUser(userId);
  
  // Clear scan state but preserve initialized flag
  const currentState = await getGmailIntegrationState(userId);
  if (currentState) {
    await setGmailIntegrationState({
      userId,
      initialized: true, // Keep integration active
      lastSuccessfulScanAt: null, // Clear scan history
      lastScanWindow: null,
    });
  }
  
  // Notify that applications changed
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new Event("jobos:gmail-applications-changed")
    );
  }
  
  return { applicationsCleared };
}

/**
 * Disconnect Gmail integration - clears everything including integration state.
 * 
 * This is a complete disconnect. User will need to re-authorize to use Gmail again.
 */
export async function disconnectGmailIntegration(
  userId: string
): Promise<void> {
  // Clear all Gmail applications
  await clearGmailApplicationsForUser(userId);
  
  // Clear integration state completely
  await clearGmailIntegrationState(userId);
  
  // Notify that applications changed
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new Event("jobos:gmail-applications-changed")
    );
  }
}

/**
 * Check if IndexedDB is available in this browser.
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Get Gmail integration state for a user.
 */
export async function getGmailIntegrationState(
  userId: string
): Promise<GmailIntegrationState | null> {
  const db = await openDatabase();
  const transaction = db.transaction(INTEGRATION_STORE_NAME, "readonly");
  const store = transaction.objectStore(INTEGRATION_STORE_NAME);

  const state = await new Promise<GmailIntegrationState | undefined>(
    (resolve, reject) => {
      const request = store.get(userId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  );

  db.close();

  return state || null;
}

/**
 * Set Gmail integration state for a user.
 */
export async function setGmailIntegrationState(
  state: GmailIntegrationState
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(INTEGRATION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(INTEGRATION_STORE_NAME);

  await new Promise<void>((resolve, reject) => {
    const request = store.put(state);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();
}

/**
 * Clear Gmail integration state for a user.
 */
export async function clearGmailIntegrationState(
  userId: string
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(INTEGRATION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(INTEGRATION_STORE_NAME);

  await new Promise<void>((resolve, reject) => {
    const request = store.delete(userId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();
}


/**
 * Update a local Gmail application (e.g., to fill in unknown company).
 * 
 * Updates the specified fields and triggers refresh event.
 */
export async function updateGmailApplication(
  userId: string,
  gmailMessageId: string,
  updates: {
    company?: string;
    role?: string;
    status?: ApplicationStatus;
  }
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  const id = `gmail-${userId}-${gmailMessageId}`;

  // Get existing record
  const existing = await new Promise<LocalGmailApplication | null>(
    (resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    }
  );

  if (!existing) {
    throw new Error("Gmail application not found");
  }

  // Update fields
  const updated: LocalGmailApplication = {
    ...existing,
    company: updates.company !== undefined ? updates.company : existing.company,
    role: updates.role !== undefined ? updates.role : existing.role,
    status: updates.status !== undefined ? updates.status : existing.status,
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const request = store.put(updated);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();

  // Notify that applications changed
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("jobos:gmail-applications-changed"));
  }
}

/**
 * Centralized 4xx-vs-transient classification for offline queue replay.
 *
 * Rules (mirrors the server's idempotency contract):
 *   • 408 / 425 / 429    → transient (rate-limited / too early / timeout — retry)
 *   • 409 key mismatch   → permanent (same key sent with different body — actionable)
 *   • Other 4xx          → permanent (bad request, gone, access denied — retrying pointless)
 *   • 5xx                → transient (server error — auto-retry)
 *   • 503 in-flight      → transient (duplicate in-flight — retry after back-off)
 *   • unknown            → rethrown as-is (network errors, etc.)
 *
 * Lives in a pure module (no react-native imports) so replay handlers and their
 * tests can depend on it without pulling in the Expo/Metro runtime.
 */

import { PermanentSyncError } from "@/lib/offlineSyncError";

/** Statuses that are transient even though they are in the 4xx range. */
const TRANSIENT_4XX = new Set([408, 425, 429]);

/**
 * Inspect a caught error and decide whether it is a permanent or transient
 * failure, then throw the right type.
 *
 * - Permanent → throws `PermanentSyncError` (queue item stays with failedReason)
 * - Transient → rethrows the original error (item stays as "Waiting", auto-retried)
 *
 * @param err        The caught error from a replay handler.
 * @param fallback   Human-readable message used when the error carries no detail.
 */
export function classifyAndRethrow(err: unknown, fallback: string): never {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: number }).status;

    // 503 is always transient: concurrent in-flight idempotency duplicate.
    if (status === 503) {
      throw err;
    }

    // 408 / 425 / 429 are transient even though they are 4xx.
    if (TRANSIENT_4XX.has(status)) {
      throw err;
    }

    // All other 4xx are permanent: bad request, conflict (key mismatch), gone, etc.
    if (status >= 400 && status < 500) {
      const msg = extractMessage(err) ?? fallback;
      throw new PermanentSyncError(msg, status, extractConflictToken(err));
    }

    // 5xx (including 500, 502, 504, …) are transient.
    if (status >= 500) {
      throw err;
    }
  }

  // Unknown shape (network error, TypeError, etc.) — rethrow as-is.
  throw err;
}

/**
 * Same as classifyAndRethrow but for raw-fetch responses where we already have
 * the status code and an optional message string.
 */
export function classifyFetchStatus(status: number, message: string): never {
  if (status === 503) {
    throw new Error(`HTTP ${status}`);
  }
  if (TRANSIENT_4XX.has(status)) {
    throw new Error(`HTTP ${status}`);
  }
  if (status >= 400 && status < 500) {
    throw new PermanentSyncError(message, status);
  }
  throw new Error(`HTTP ${status}`);
}

function extractMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) return e;
  }
  const msg = (err as { message?: unknown }).message;
  if (typeof msg === "string" && msg.trim()) return msg;
  return null;
}

function extractConflictToken(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const token = (data as { conflictToken?: unknown }).conflictToken;
  return typeof token === "string" && token.trim() ? token : undefined;
}

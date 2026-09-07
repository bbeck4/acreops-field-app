/**
 * Pure helpers extracted from QueueSync for compound write operations that need
 * deterministic idempotency keys and are unit-testable without React Native.
 *
 * Compound sampling writes (samplingAddPoint) dispatch multiple server calls
 * in sequence: create → claim → assign. Each call gets a stable step key
 * derived from the queue write id so retries resume at the right step without
 * duplication.
 *
 * Step key scheme (for a writeId "abc123"):
 *   create  → "abc123:create"
 *   claim   → "abc123:claim"
 *   assign  → "abc123:assign"
 *
 * No react-native imports here — only generated API client calls and
 * lib/syncClassify, so Vitest can run these in a Node environment.
 */

import { PermanentSyncError } from "@/lib/offlineSyncError";
import { classifyAndRethrow } from "@/lib/syncClassify";

/** Build a deterministic step key for a compound write sub-operation. */
export function stepKey(writeId: string, step: string): string {
  return `${writeId}:${step}`;
}

/**
 * Build a `RequestInit`-compatible headers object carrying the idempotency key.
 * Returns `undefined` when writeId is empty/falsy so callers can spread it
 * safely.
 */
export function idempotencyHeaders(
  idempotencyKey: string | undefined,
): RequestInit | undefined {
  if (!idempotencyKey) return undefined;
  return { headers: { "X-Idempotency-Key": idempotencyKey } };
}

/**
 * Build a `RequestInit` options object with the X-Idempotency-Key header set
 * to the given key.  Always returns an object (never undefined).
 */
export function withIdempotencyKey(key: string): RequestInit {
  return { headers: { "X-Idempotency-Key": key } };
}

/**
 * Classify an unknown replay error and re-throw.
 *
 * Convenience re-export so callers in QueueSync don't need a separate import
 * from syncClassify when they already import from this module.
 */
export { classifyAndRethrow, PermanentSyncError };

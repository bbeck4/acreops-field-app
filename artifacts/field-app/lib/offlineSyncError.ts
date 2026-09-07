/**
 * Throw this (instead of a generic Error) from a queue-replay handler to signal
 * that the server permanently rejected the write (e.g. HTTP 4xx). The flush loop
 * keeps the item in the queue with failedReason set so the pending-sync tray can
 * surface it to the rep for manual review/discard.
 *
 * Generic (transient) errors — network timeouts, 5xx, etc. — should be thrown as
 * plain Errors; those items are kept without failedReason so they show as
 * "Waiting" and are auto-retried.
 *
 * Lives in a pure module (no react-native imports) so replay handlers and their
 * tests can depend on it without pulling in the Expo/Metro runtime.
 */
export class PermanentSyncError extends Error {
  constructor(
    public readonly serverMessage: string,
    public readonly status?: number,
    public readonly conflictToken?: string,
  ) {
    super(serverMessage);
    this.name = "PermanentSyncError";
  }
}

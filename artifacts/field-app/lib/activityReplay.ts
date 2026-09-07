import { PermanentSyncError } from "@/lib/offlineSyncError";

/**
 * Replays a queued customer activity.
 *
 * Server rejections are permanent queue failures so the sync tray can explain
 * them and offer a deliberate retry/discard choice. Network errors and 5xx
 * responses remain transient and are retried by QueueSync.
 */
export async function postActivity(payload: unknown, token: string): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return;

  const activity = payload as Record<string, unknown> | null;
  if (!activity || typeof activity !== "object") return;

  const response = await fetch(`https://${domain}/api/activities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(activity),
  });

  if (response.status >= 400 && response.status < 500) {
    const prefix =
      response.status === 409
        ? "Conflict while syncing activity (HTTP 409)"
        : `Server rejected this activity (HTTP ${response.status})`;
    let message = prefix;

    try {
      const body = (await response.json()) as { error?: string; message?: string };
      const detail = body?.error || body?.message;
      if (detail) message = `${prefix}: ${detail}`;
    } catch {
      // Keep the status-based message when the server did not return JSON.
    }

    throw new PermanentSyncError(message);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
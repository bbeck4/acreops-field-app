import { PermanentSyncError } from "@/lib/offlineSyncError";
import { classifyFetchStatus } from "@/lib/syncClassify";

// Replay a queued "servicePackageOrder" write against POST
// /api/service-packages/save. Extracted from QueueSync so it can be unit-tested
// with a mocked fetch (the QueueSync component itself pulls in react-native).
//
// 4xx (except 408/425/429) = permanent (bad/gone customer, prospect not
// quote-able, key mismatch, etc.). Surface it as a PermanentSyncError so the
// tray keeps it for the rep to review instead of silently retrying forever.
// 408/425/429 and 5xx / network errors re-throw as plain Errors so the flush
// loop keeps the item as "Waiting" and auto-retries.
//
// The stable queue write id is sent as X-Idempotency-Key so replays that reach
// the server more than once are deduplicated by the server and never double-post.
export async function postServicePackageOrder(
  payload: unknown,
  token: string,
  writeId?: string,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured — cannot replay servicePackageOrder",
    );
  }
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") {
    throw new PermanentSyncError(
      "servicePackageOrder payload is missing or not an object — cannot replay",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (writeId) {
    headers["X-Idempotency-Key"] = writeId;
  }

  const res = await fetch(`https://${domain}/api/service-packages/save`, {
    method: "POST",
    headers,
    body: JSON.stringify(p),
  });
  if (res.status >= 400) {
    let msg = `Server rejected this quote (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // ignore non-JSON error bodies
    }
    classifyFetchStatus(res.status, msg);
  }
}

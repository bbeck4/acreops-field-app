export const OFFLINE_DATA_OWNER_KEY = "@security:offline-data-owner-v1";

const SENSITIVE_OFFLINE_PREFIXES = ["@agriops:", "@cache:"];

export function isSensitiveOfflineKey(key: string): boolean {
  return SENSITIVE_OFFLINE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function offlineKeysToClear(keys: readonly string[]): string[] {
  return keys.filter(
    (key) => key !== OFFLINE_DATA_OWNER_KEY && isSensitiveOfflineKey(key),
  );
}

export function offlineOwnerIdentity(
  isSignedIn: boolean | undefined,
  userId: string | null | undefined,
): string {
  return isSignedIn && userId ? `clerk:${userId}` : "signed-out";
}
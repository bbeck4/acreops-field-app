import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/expo";
import React, { useEffect, useMemo, useState } from "react";

import {
  OFFLINE_DATA_OWNER_KEY,
  offlineKeysToClear,
  offlineOwnerIdentity,
} from "@/lib/offlineDataIsolation";

interface OfflineIdentityBoundaryProps {
  children: React.ReactNode;
  onIdentityChange?: () => void;
}

/**
 * Prevents cached operational data and pending writes from crossing Clerk
 * accounts on a shared device. Children do not mount until the persisted owner
 * marker matches the active identity, so consumers cannot race the cleanup.
 */
export function OfflineIdentityBoundary({
  children,
  onIdentityChange,
}: OfflineIdentityBoundaryProps) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const owner = useMemo(
    () => (isLoaded ? offlineOwnerIdentity(isSignedIn, userId) : null),
    [isLoaded, isSignedIn, userId],
  );
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const prepareIdentity = async () => {
      try {
        const previousOwner = await AsyncStorage.getItem(OFFLINE_DATA_OWNER_KEY);
        if (previousOwner !== owner) {
          const keys = await AsyncStorage.getAllKeys();
          const sensitiveKeys = offlineKeysToClear(keys);
          if (sensitiveKeys.length > 0) {
            await AsyncStorage.multiRemove(sensitiveKeys);
          }
          onIdentityChange?.();
          await AsyncStorage.setItem(OFFLINE_DATA_OWNER_KEY, owner);
        }
        if (active) setReadyOwner(owner);
      } catch {
        // Fail closed: keep account-scoped children unmounted and retry after a
        // short delay instead of exposing the prior identity's cache.
        if (active) {
          retryTimer = setTimeout(() => setRetry((value) => value + 1), 500);
        }
      }
    };

    void prepareIdentity();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [owner, onIdentityChange, retry]);

  if (!owner || readyOwner !== owner) return null;
  return <>{children}</>;
}
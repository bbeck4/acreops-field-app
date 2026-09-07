import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

/**
 * Returns live data when online; falls back to AsyncStorage-cached value when offline.
 * Automatically updates the cache whenever new live data arrives.
 */
export function useOfflineCache<T>(
  cacheKey: string,
  liveData: T | undefined,
  isOffline: boolean
): T | undefined {
  const [cached, setCached] = useState<T | undefined>(undefined);
  const storageKey = `@cache:${cacheKey}`;

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (raw) {
        try {
          setCached(JSON.parse(raw) as T);
        } catch {}
      }
    });
  }, [storageKey]);

  useEffect(() => {
    if (liveData !== undefined) {
      AsyncStorage.setItem(storageKey, JSON.stringify(liveData)).catch(() => {});
      setCached(liveData);
    }
  }, [storageKey, liveData]);

  return liveData !== undefined ? liveData : isOffline ? cached : undefined;
}

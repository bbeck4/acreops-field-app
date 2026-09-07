import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export type DistanceUnit = "mi" | "km";

const STORAGE_KEY = "agri:distanceUnit";

const listeners = new Set<(unit: DistanceUnit) => void>();
let cached: DistanceUnit = "mi";
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    cached = v === "km" ? "km" : "mi";
  } catch {
    cached = "mi";
  }
  loaded = true;
  listeners.forEach((l) => l(cached));
}

export async function setDistanceUnit(unit: DistanceUnit) {
  cached = unit;
  loaded = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l(cached));
}

export function useDistanceUnit(): DistanceUnit {
  const [unit, setUnit] = useState<DistanceUnit>(cached);
  useEffect(() => {
    listeners.add(setUnit);
    if (!loaded) {
      ensureLoaded();
    } else {
      setUnit(cached);
    }
    return () => {
      listeners.delete(setUnit);
    };
  }, []);
  return unit;
}

export function formatDistance(
  km: number | null | undefined,
  unit: DistanceUnit,
): string | null {
  if (km == null) return null;
  if (unit === "km") {
    return `${km.toFixed(km >= 10 ? 0 : 1)} km`;
  }
  const mi = km * 0.621371;
  return `${mi.toFixed(mi >= 10 ? 0 : 1)} mi`;
}

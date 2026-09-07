import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

// Which home a dual-role member wants to land on: the full rep/agronomist
// dashboard, or their operational track (warehouse/fulfillment/delivery stub).
// Only meaningful for members who hold both a full-dashboard role AND an
// operational role — single-role members never see the switcher, so this
// preference is simply ignored for them.
export type HomeTrack = "dashboard" | "operational";

const STORAGE_KEY = "agri:homeTrack";

const listeners = new Set<(track: HomeTrack) => void>();
let cached: HomeTrack = "dashboard";
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    cached = v === "operational" ? "operational" : "dashboard";
  } catch {
    cached = "dashboard";
  }
  loaded = true;
  listeners.forEach((l) => l(cached));
}

export async function setHomeTrack(track: HomeTrack) {
  cached = track;
  loaded = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, track);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l(cached));
}

export function useHomeTrack(): HomeTrack {
  const [track, setTrack] = useState<HomeTrack>(cached);
  useEffect(() => {
    listeners.add(setTrack);
    if (!loaded) {
      ensureLoaded();
    } else {
      setTrack(cached);
    }
    return () => {
      listeners.delete(setTrack);
    };
  }, []);
  return track;
}

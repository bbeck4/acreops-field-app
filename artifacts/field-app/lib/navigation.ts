import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";

// Shared maps hand-off. Every "Navigate"/"Directions" tap in the app funnels
// through openNavigation() so the rep's preferred maps app (Apple / Google /
// Waze, persisted on-device) is respected everywhere, with graceful fallback
// to the platform default when the preferred app isn't installed.

export type MapsApp = "apple" | "google" | "waze";

export type NavDestination = {
  lat?: number | null;
  lng?: number | null;
  /** Free-text address; used when coords are missing (Waze requires coords). */
  address?: string | null;
  /** Optional display label for the destination pin. */
  label?: string | null;
};

const STORAGE_KEY = "agri:preferredMapsApp";

// Apple Maps only exists on iOS, so it can't be the default (or even an
// option) elsewhere.
const DEFAULT_APP: MapsApp = Platform.OS === "ios" ? "apple" : "google";

export const MAPS_APP_OPTIONS: { key: MapsApp; label: string }[] = [
  ...(Platform.OS === "ios" ? [{ key: "apple" as const, label: "Apple Maps" }] : []),
  { key: "google", label: "Google Maps" },
  { key: "waze", label: "Waze" },
];

function normalize(v: string | null): MapsApp {
  if (v === "google" || v === "waze") return v;
  if (v === "apple" && Platform.OS === "ios") return "apple";
  return DEFAULT_APP;
}

// Module-level cache + listeners, same pattern as lib/units.ts, so every
// mounted hook stays in sync and reads are synchronous after first load.
const listeners = new Set<(app: MapsApp) => void>();
let cached: MapsApp = DEFAULT_APP;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    cached = normalize(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    cached = DEFAULT_APP;
  }
  loaded = true;
  listeners.forEach((l) => l(cached));
}

export async function setPreferredMapsApp(app: MapsApp) {
  cached = normalize(app);
  loaded = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, cached);
  } catch {
    // ignore — preference just won't survive a restart
  }
  listeners.forEach((l) => l(cached));
}

export function usePreferredMapsApp(): MapsApp {
  const [app, setApp] = useState<MapsApp>(cached);
  useEffect(() => {
    listeners.add(setApp);
    if (!loaded) {
      ensureLoaded();
    } else {
      setApp(cached);
    }
    return () => {
      listeners.delete(setApp);
    };
  }, []);
  return app;
}

function hasCoords(d: NavDestination): boolean {
  return d.lat != null && d.lng != null;
}

/** True when the destination has enough info to navigate to at all. */
export function canNavigate(d: NavDestination | null | undefined): boolean {
  if (!d) return false;
  return hasCoords(d) || !!d.address?.trim();
}

// openURL (unlike canOpenURL) doesn't require LSApplicationQueriesSchemes on
// iOS — it simply rejects when no app handles the scheme, which is exactly
// the "not installed" signal we want for the fallback chain.
async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open turn-by-turn directions to `dest` in the user's preferred maps app,
 * falling back to the platform default (Apple Maps on iOS, Google Maps
 * elsewhere) when the preferred app isn't installed or can't handle the
 * destination (e.g. Waze without coordinates).
 *
 * Returns false only when the destination has neither coords nor an address,
 * or every candidate URL failed to open.
 */
export async function openNavigation(
  dest: NavDestination,
  appOverride?: MapsApp,
): Promise<boolean> {
  await ensureLoaded();
  const app = appOverride ?? cached;

  const coords = hasCoords(dest);
  const address = dest.address?.trim() || null;
  if (!coords && !address) return false;

  const ll = coords ? `${dest.lat},${dest.lng}` : null;
  // Query string used as the destination: coords when we have them (most
  // precise), otherwise the URL-encoded address.
  const q = ll ?? encodeURIComponent(address!);
  const label = dest.label?.trim() || null;

  const candidates: string[] = [];

  if (Platform.OS !== "web") {
    if (app === "waze") {
      // Waze deep links require coordinates. Address-only destinations skip
      // straight to the platform default below.
      if (ll) candidates.push(`waze://?ll=${ll}&navigate=yes`);
    } else if (app === "google") {
      candidates.push(
        Platform.OS === "ios"
          ? `comgooglemaps://?daddr=${q}&directionsmode=driving`
          : `google.navigation:q=${q}`,
      );
    }
    // Platform default (also the preferred target when app === "apple").
    if (Platform.OS === "ios") {
      candidates.push(
        `maps://?daddr=${q}${label ? `&q=${encodeURIComponent(label)}` : ""}`,
      );
    }
  }

  // Universal last resort: opens the Google Maps app when installed, the
  // browser otherwise. Also the only path on web.
  candidates.push(`https://www.google.com/maps/dir/?api=1&destination=${q}`);

  for (const url of candidates) {
    if (await tryOpen(url)) return true;
  }
  return false;
}

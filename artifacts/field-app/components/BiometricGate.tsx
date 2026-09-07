import { Feather } from "@expo/vector-icons";
import { useAuth, useClerk } from "@clerk/expo";
import * as LocalAuthentication from "expo-local-authentication";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

// Relock if the app has been in the background longer than this.
const RELOCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Requires biometric (Face ID / fingerprint, with device passcode fallback)
 * unlock before showing app content when the user is signed in.
 *
 * - Web: no-op (biometrics unsupported there).
 * - Devices without biometrics enrolled: no-op.
 * - Locks on cold start and after >5 min in the background.
 */
export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const colors = useColors();

  const supported = Platform.OS !== "web";
  const [available, setAvailable] = useState<boolean | null>(supported ? null : false);
  const [locked, setLocked] = useState(true);
  const [prompting, setPrompting] = useState(false);
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  // Invalidates in-flight prompts when a relock happens (e.g. long background
  // stay while a prompt was open) so a stale success can't unlock.
  const lockGeneration = useRef(0);
  // A user who just completed the sign-in flow (email code etc.) has already
  // proven who they are — don't immediately demand biometrics on top. Only a
  // cold start with an existing session, or a long background stay, locks.
  const prevSignedIn = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevSignedIn.current === false && isSignedIn) {
      setLocked(false);
      setFailed(false);
    }
    prevSignedIn.current = isSignedIn ?? undefined;
  }, [isSignedIn]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!cancelled) setAvailable(hasHardware && enrolled);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const promptUnlock = useCallback(async () => {
    if (prompting) return;
    const generation = lockGeneration.current;
    setPrompting(true);
    setFailed(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock AcreOps",
        cancelLabel: "Cancel",
      });
      if (generation !== lockGeneration.current) return; // relocked mid-prompt
      if (result.success) {
        setLocked(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPrompting(false);
    }
  }, [prompting]);

  // Relock when returning from a long background stay.
  useEffect(() => {
    if (!supported) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
      } else if (state === "active") {
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (away != null && Date.now() - away > RELOCK_AFTER_MS) {
          lockGeneration.current += 1;
          setLocked(true);
          setFailed(false);
        }
      }
    });
    return () => sub.remove();
  }, [supported]);

  const checking = Boolean(isSignedIn && supported && locked && available === null);
  const gateActive = Boolean(isSignedIn && available && locked);

  // Auto-prompt as soon as the lock screen appears.
  useEffect(() => {
    if (gateActive && !failed) {
      void promptUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateActive]);

  // Cold start: don't flash signed-in content while we check whether the
  // device can do biometrics.
  if (checking) {
    return <View style={[styles.root, { backgroundColor: colors.background }]} />;
  }

  if (!gateActive) return <>{children}</>;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.iconCircle, { backgroundColor: colors.primary + "22" }]}>
        <Feather name="lock" size={36} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>AcreOps is locked</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Unlock with Face ID, fingerprint, or your device passcode.
      </Text>
      <Pressable
        onPress={promptUnlock}
        disabled={prompting}
        style={({ pressed }) => [
          styles.unlockBtn,
          { backgroundColor: colors.primary, opacity: pressed || prompting ? 0.7 : 1 },
        ]}
      >
        <Feather name="unlock" size={18} color="#fff" />
        <Text style={styles.unlockText}>{prompting ? "Unlocking…" : "Unlock"}</Text>
      </Pressable>
      <Pressable onPress={() => signOut()} hitSlop={8} style={styles.signOutBtn}>
        <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out instead</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 28,
    height: 50,
    marginTop: 16,
  },
  unlockText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  signOutBtn: { marginTop: 8, padding: 8 },
  signOutText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});

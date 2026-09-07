import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth, useClerk } from "@clerk/expo";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type ClaimableProfile = {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
};

export default function ClaimProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { claimMember } = useAppAuth();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);
  const [claiming, setClaiming] = useState(false);
  const [profile, setProfile] = useState<ClaimableProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const load = async () => {
      try {
        const token = await getTokenRef.current();
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        const base = domain ? `https://${domain}/api` : `http://localhost:8080/api`;
        const res = await fetch(`${base}/auth/claimable-profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setProfile(data as ClaimableProfile);
          } else {
            setFetchError(
              res.status === 404
                ? "No profile found matching your email. Contact your administrator."
                : "Could not load your profile. Please try again.",
            );
          }
        }
      } catch {
        if (!cancelled) setFetchError("Network error. Check your connection and try again.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleClaim = async () => {
    if (!profile) return;
    setClaiming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await claimMember(profile.id);
    if (!result) {
      Alert.alert(
        "Could not claim profile",
        "This profile may already be linked to another account. Contact your administrator.",
      );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setClaiming(false);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 16, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
          <Feather name="user-check" size={22} color="#fff" />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Confirm your profile</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Link your Clerk account to your team member profile. This is a one-time setup.
        </Text>
      </View>

      <View style={styles.body}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : fetchError ? (
          <View style={styles.emptyWrap}>
            <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{fetchError}</Text>
          </View>
        ) : profile ? (
          <View style={styles.cardWrap}>
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                <Text style={[styles.avatarText, { color: colors.accentForeground }]}>
                  {profile.name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={[styles.cardName, { color: colors.foreground }]}>{profile.name}</Text>
                {profile.role ? (
                  <Text style={[styles.cardRole, { color: colors.mutedForeground }]}>
                    {profile.role}
                  </Text>
                ) : null}
                {profile.email ? (
                  <Text style={[styles.cardEmail, { color: colors.mutedForeground }]}>
                    {profile.email}
                  </Text>
                ) : null}
              </View>
              <Feather name="check-circle" size={20} color={colors.primary} />
            </View>

            <Pressable
              style={[
                styles.claimBtn,
                { backgroundColor: colors.primary, opacity: claiming ? 0.6 : 1 },
              ]}
              onPress={handleClaim}
              disabled={claiming}
            >
              {claiming ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="link" size={16} color="#fff" />
                  <Text style={styles.claimBtnText}>This is me — Claim Profile</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + 16, borderTopColor: colors.border },
        ]}
      >
        <Pressable
          style={[styles.signOutBtn, { borderColor: colors.border }]}
          onPress={() => signOut()}
        >
          <Feather name="log-out" size={16} color={colors.mutedForeground} />
          <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    gap: 8,
    alignItems: "center",
  },
  logoCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  body: { flex: 1, justifyContent: "center" },
  cardWrap: { padding: 16, gap: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardRole: { fontSize: 13, fontFamily: "Inter_400Regular", textTransform: "capitalize" },
  cardEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  claimBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyWrap: { alignItems: "center", gap: 12, paddingTop: 40, paddingHorizontal: 32 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    alignItems: "center",
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  signOutText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});

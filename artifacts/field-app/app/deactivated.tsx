import { Feather } from "@expo/vector-icons";
import { useClerk } from "@clerk/expo";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

// Shown when the member-profile fetch returns a 403 (account deactivated).
// Mirrors the web MemberGate's deactivation screen: a clear, final message
// with sign-out as the only action — no claim flow, no retry.
export default function DeactivatedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useClerk();

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 16, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.logoCircle, { backgroundColor: colors.destructive }]}>
          <Feather name="slash" size={22} color="#fff" />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Your account has been deactivated
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          You no longer have access to this workspace. Contact an administrator if
          you believe this is a mistake.
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.emptyWrap}>
          <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Sign out and reach out to your administrator to restore access.
          </Text>
        </View>
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
          <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>
            Sign out
          </Text>
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

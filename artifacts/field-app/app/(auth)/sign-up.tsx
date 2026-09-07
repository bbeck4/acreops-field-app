import { Feather } from "@expo/vector-icons";
import { useSignUp } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBranding } from "@/context/BrandingContext";
import { useColors } from "@/hooks/useColors";

export default function SignUpScreen() {
  const colors = useColors();
  const branding = useBranding();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useSignUp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signUpError } = await signUp.password({ emailAddress: email, password });
      if (signUpError) {
        setError(signUpError.message ?? "Sign up failed. Please try again.");
        return;
      }
      if (signUp.status === "complete") {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) { setError(finalizeError.message ?? "Could not complete sign up."); return; }
        router.replace("/");
      } else if (signUp.status === "missing_requirements") {
        const { error: sendError } = await signUp.verifications.sendEmailCode();
        if (sendError) { setError(sendError.message ?? "Could not send verification code."); return; }
        setPendingVerification(true);
      } else {
        setError("Account creation could not be completed. Please try again.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
      if (verifyError) {
        setError(verifyError.message ?? "Invalid code. Please try again.");
        return;
      }
      if (signUp.status === "complete") {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) { setError(finalizeError.message ?? "Could not complete sign up."); return; }
        router.replace("/");
      } else {
        setError("Verification could not be completed. Please try again.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    try { await signUp.verifications.sendEmailCode(); } catch { /* ignore */ }
  };

  if (pendingVerification) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.inner}>
          <Text style={[styles.title, { color: colors.foreground }]}>Verify your email</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter the verification code sent to {email}.
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="6-digit code"
            placeholderTextColor={colors.mutedForeground}
            value={code}
            onChangeText={setCode}
            keyboardType="numeric"
            autoFocus
          />
          {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
          <Pressable
            style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.6 : 1 }]}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify email</Text>}
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={resendCode}>
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Resend code</Text>
          </Pressable>
        </View>
        <View nativeID="clerk-captcha" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>

        <View style={[styles.logoWrap, { marginTop: 16 }]}>
          <Image
            source={
              branding.logoUrl
                ? { uri: branding.logoUrl }
                : require("../../assets/images/longacres-logo.webp")
            }
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={branding.name ?? "Company logo"}
          />
          <Text style={[styles.appName, { color: colors.primary }]}>AcreOps</Text>
          {branding.name ? (
            <Text style={{ fontSize: 12, marginTop: 2 }}>
              <Text style={{ color: colors.primary, fontWeight: "600" }}>{branding.name}</Text>
            </Text>
          ) : null}
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Join your team on AcreOps Field</Text>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="you@example.com"
          placeholderTextColor={colors.mutedForeground}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
        <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.passwordInput, { color: colors.foreground }]}
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
          />
          <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
            <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, { backgroundColor: colors.primary, opacity: (!email || !password || loading) ? 0.6 : 1 }]}
          onPress={handleSignUp}
          disabled={!email || !password || loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create account</Text>}
        </Pressable>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Already have an account? </Text>
          <Link href={"/(auth)/sign-in" as Href}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Sign in</Text>
          </Link>
        </View>
      </ScrollView>
      <View nativeID="clerk-captcha" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { paddingHorizontal: 24, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  logoWrap: { alignItems: "center", gap: 8, marginBottom: 24 },
  logo: { width: 210, height: 110 },
  appName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 8 },
  input: { height: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular" },
  passwordWrap: { height: 48, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  passwordInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  eyeBtn: { padding: 4 },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  btn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 16 },
  btnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { alignItems: "center", paddingVertical: 8 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 16 },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

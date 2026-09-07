import { Feather } from "@expo/vector-icons";
import { useSignIn } from "@clerk/expo";
import { type Href, Link, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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

type Step = "password" | "mfa";

export default function SignInScreen() {
  const colors = useColors();
  const branding = useBranding();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useSignIn();
  const { ticket: ticketParam } = useLocalSearchParams<{ ticket?: string | string[] }>();
  const consumedTicket = useRef<string | null>(null);

  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ticket = typeof ticketParam === "string" ? ticketParam : null;
    if (!ticket || consumedTicket.current === ticket) return;

    consumedTicket.current = ticket;
    let cancelled = false;

    const completeTicketSignIn = async () => {
      setLoading(true);
      setError(null);
      try {
        const { error: ticketError } = await signIn.create({ strategy: "ticket", ticket });
        if (ticketError) {
          if (!cancelled) setError(ticketError.message ?? "This mobile sign-in code is no longer valid.");
          return;
        }
        if (signIn.status === "complete") {
          const { error: finalizeError } = await signIn.finalize();
          if (finalizeError) {
            if (!cancelled) setError(finalizeError.message ?? "Could not complete mobile sign in.");
            return;
          }
          router.replace("/");
        } else if (signIn.status === "needs_second_factor") {
          const { error: mfaError } = await signIn.mfa.sendEmailCode();
          if (mfaError) {
            if (!cancelled) setError(mfaError.message ?? "Could not send the verification code.");
            return;
          }
          if (!cancelled) setStep("mfa");
        } else if (!cancelled) {
          setError("This mobile sign-in code could not be completed. Please sign in normally.");
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "This mobile sign-in code is no longer valid.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void completeTicketSignIn();
    return () => {
      cancelled = true;
    };
  }, [router, signIn, ticketParam]);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await signIn.password({ emailAddress: email, password });
      if (signInError) {
        setError(signInError.message ?? "Sign in failed. Check your credentials.");
        return;
      }
      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) { setError(finalizeError.message ?? "Could not complete sign in."); return; }
        router.replace("/");
      } else if (signIn.status === "needs_second_factor") {
        const { error: mfaError } = await signIn.mfa.sendEmailCode();
        if (mfaError) { setError(mfaError.message ?? "Could not send verification code."); return; }
        setStep("mfa");
      } else {
        setError("Sign in could not be completed. Please try again.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code });
      if (verifyError) {
        setError(verifyError.message ?? "Invalid code. Please try again.");
        return;
      }
      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) { setError(finalizeError.message ?? "Could not complete sign in."); return; }
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

  const resendMfaCode = async () => {
    try { await signIn.mfa.sendEmailCode(); } catch { /* ignore */ }
  };

  if (step === "mfa") {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.inner}>
          <Text style={[styles.title, { color: colors.foreground }]}>Verify your identity</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter the verification code sent to your email.
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
            onPress={handleVerifyMfa}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify</Text>}
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={resendMfaCode}>
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Resend code</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => { setStep("password"); setCode(""); setError(null); }}>
            <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Start over</Text>
          </Pressable>
        </View>
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
        {router.canGoBack() && (
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
        )}

        <View style={[styles.logoWrap, router.canGoBack() ? { marginTop: 16 } : { marginTop: 40 }]}>
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

        <Text style={[styles.title, { color: colors.foreground }]}>Together We Grow!</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in to your field account</Text>

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

        <View style={styles.passwordLabelRow}>
          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 0 }]}>Password</Text>
          <Link href={"/(auth)/forgot-password" as Href} asChild>
            <Pressable hitSlop={8}>
              <Text style={[styles.forgotLink, { color: colors.primary }]}>Forgot password?</Text>
            </Pressable>
          </Link>
        </View>
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
          onPress={handleSignIn}
          disabled={!email || !password || loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign in</Text>}
        </Pressable>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>Don't have an account? </Text>
          <Link href={"/(auth)/sign-up" as Href}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Sign up</Text>
          </Link>
        </View>
      </ScrollView>
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
  passwordLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  forgotLink: { fontSize: 13, fontFamily: "Inter_500Medium" },
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

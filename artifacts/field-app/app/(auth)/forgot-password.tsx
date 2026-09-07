import { Feather } from "@expo/vector-icons";
import { useSignIn } from "@clerk/expo";
import { type Href, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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

import { useColors } from "@/hooks/useColors";

type Step = "request" | "reset" | "done";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useSignIn();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: createError } = await signIn.create({ identifier: email });
      if (createError) {
        setError(createError.message ?? "Could not find an account with that email.");
        return;
      }
      const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendError) {
        setError(sendError.message ?? "Could not send reset code. Please try again.");
        return;
      }
      setStep("reset");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not find an account with that email.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await signIn.resetPasswordEmailCode.verifyCode({ code });
      if (verifyError) {
        setError(verifyError.message ?? "Invalid code. Please check and try again.");
        return;
      }
      const { error: passwordError } = await signIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
        signOutOfOtherSessions: true,
      });
      if (passwordError) {
        setError(passwordError.message ?? "Could not set new password. Please try again.");
        return;
      }
      const currentStatus = signIn.status as string;
      if (currentStatus === "complete") {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) { setError(finalizeError.message ?? "Password reset but sign in failed."); return; }
        router.replace("/");
      } else {
        setStep("done");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset password. Please check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.inner, { alignItems: "center", paddingTop: 60 }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="check-circle" size={36} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.foreground, textAlign: "center", marginTop: 20 }]}>
            Password updated
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: "center" }]}>
            Your password has been reset. Sign in with your new password.
          </Text>
          <Pressable
            style={[styles.btn, { backgroundColor: colors.primary, marginTop: 32 }]}
            onPress={() => router.replace("/(auth)/sign-in" as Href)}
          >
            <Text style={styles.btnText}>Go to Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const handleBack = () => {
    if (step === "reset") { setStep("request"); return; }
    router.back();
  };

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
        <Pressable style={styles.backBtn} onPress={handleBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>

        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20", marginTop: 32 }]}>
          <Feather name="lock" size={28} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground, marginTop: 20 }]}>
          {step === "request" ? "Forgot password?" : "Reset password"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {step === "request"
            ? "Enter your email and we'll send a reset code."
            : `Enter the code sent to ${email} and choose a new password.`}
        </Text>

        {step === "request" && (
          <>
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
              autoFocus
            />
            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary, opacity: (!email || loading) ? 0.6 : 1 }]}
              onPress={handleSendCode}
              disabled={!email || loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send reset code</Text>}
            </Pressable>
          </>
        )}

        {step === "reset" && (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Reset code</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              placeholder="6-digit code"
              placeholderTextColor={colors.mutedForeground}
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              autoFocus
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>New password</Text>
            <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                style={[styles.passwordInput, { color: colors.foreground }]}
                placeholder="New password"
                placeholderTextColor={colors.mutedForeground}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary, opacity: (!code || !newPassword || loading) ? 0.6 : 1 }]}
              onPress={handleResetPassword}
              disabled={!code || !newPassword || loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Set new password</Text>}
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={handleSendCode} disabled={loading}>
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Resend code</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { paddingHorizontal: 24, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  iconCircle: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
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
});

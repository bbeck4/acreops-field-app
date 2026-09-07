import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkLoaded, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter, setBaseUrl, setUnauthenticatedHandler } from "@workspace/api-client-react";
import { router, Stack, useGlobalSearchParams, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BiometricGate } from "@/components/BiometricGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineIdentityBoundary } from "@/components/OfflineIdentityBoundary";
import { PendingSyncTray } from "@/components/PendingSyncTray";
import { QueueSync } from "@/components/QueueSync";
import { AuthProvider, useAppAuth } from "@/context/AuthContext";
import { BrandingProvider } from "@/context/BrandingContext";
import { OfflineProvider } from "@/context/OfflineContext";
import { PrivacyProvider } from "@/context/PrivacyContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
    },
  },
});

function ClerkTokenSetup() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

function UnauthHandler() {
  const { signOut } = useAuth();
  useEffect(() => {
    setUnauthenticatedHandler(async () => {
      await signOut();
      router.replace("/(auth)/sign-in" as never);
    });
    return () => {
      setUnauthenticatedHandler(null);
    };
  }, [signOut]);
  return null;
}

function RootLayoutNav() {
  const { isSignedIn, isLoaded } = useAuth();
  const { currentMember, isLoading, isDeactivated } = useAppAuth();
  const segments = useSegments();
  const { ticket: ticketParam } = useGlobalSearchParams<{ ticket?: string | string[] }>();
  usePushNotifications();

  useEffect(() => {
    if (!isLoaded || isLoading) return;

    const seg0 = segments[0] as string;
    const inAuthGroup = seg0 === "(auth)";
    const inTicketLogin = seg0 === "login";
    const inClaimProfile = seg0 === "claim-profile";
    const inDeactivated = seg0 === "deactivated";
    const ticket = typeof ticketParam === "string" && ticketParam.length > 0 ? ticketParam : null;

    if (!isSignedIn) {
      if (ticket) {
        // Expo Go must load a manifest from the server root. Preserve its
        // one-time ticket while moving from that root URL into /login.
        if (!inAuthGroup && !inTicketLogin) {
          router.replace(`/login?ticket=${encodeURIComponent(ticket)}` as never);
        }
      } else if (!inAuthGroup && !inTicketLogin) {
        router.replace("/(auth)/sign-in" as never);
      }
    } else if (isDeactivated) {
      // 403 from member-profile → account deactivated. Final state: show the
      // deactivation screen, never the claim flow.
      if (!inDeactivated) router.replace("/deactivated" as never);
    } else if (!currentMember) {
      if (!inClaimProfile) router.replace("/claim-profile" as never);
    } else {
      if (inAuthGroup || inClaimProfile || inDeactivated) router.replace("/(tabs)");
    }
  }, [isLoaded, isLoading, isSignedIn, currentMember, isDeactivated, segments, ticketParam]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="claim-profile" />
      <Stack.Screen name="deactivated" />
      <Stack.Screen
        name="customer/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="prospects/index"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="prospect/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="prospect/new"
        options={{ animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="voice-inbox"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="commission"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="contact-info"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="allocation-requests"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="board"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="order/new"
        options={{ animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="service-packages"
        options={{ animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="order/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="customer/new"
        options={{ animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="recommendations/[customerId]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="recommendation/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="product/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="products"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="scan"
        options={{ animation: "slide_from_bottom", presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="sampling/index"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="sampling/scan"
        options={{ animation: "slide_from_bottom", presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="sampling/quick-scan"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="sampling/collect"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="sampling/guided"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="sampling/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="routes/plan"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="blanket/[id]"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="blend/index"
        options={{ animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="blend/dry"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="blend/liquid"
        options={{ animation: "slide_from_right" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const clearAccountState = useCallback(() => {
    queryClient.clear();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <ClerkLoaded>
        <SafeAreaProvider>
          <OfflineIdentityBoundary onIdentityChange={clearAccountState}>
            <ErrorBoundary>
              <QueryClientProvider client={queryClient}>
                <ClerkTokenSetup />
                <UnauthHandler />
                <BrandingProvider>
                <AuthProvider>
                  <PrivacyProvider>
                  <OfflineProvider>
                    <GestureHandlerRootView>
                      <KeyboardProvider>
                        <QueueSync />
                        <BiometricGate>
                          <PendingSyncTray />
                          <RootLayoutNav />
                        </BiometricGate>
                      </KeyboardProvider>
                    </GestureHandlerRootView>
                  </OfflineProvider>
                  </PrivacyProvider>
                </AuthProvider>
                </BrandingProvider>
              </QueryClientProvider>
            </ErrorBoundary>
          </OfflineIdentityBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";

// Tab visibility is now driven by the member's effective permissions (the
// role → permission matrix), consistent with the web platform. The tab →
// permission map lives in @/lib/permissions (TAB_PERMISSIONS).
function useVisibleTabs(): (name: string) => boolean {
  const { canSeeTab } = usePermissions();
  return canSeeTab;
}

function NativeTabLayout() {
  const visible = useVisibleTabs();
  return (
    <NativeTabs>
      {visible("index") && (
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
          <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {visible("customers") && (
        <NativeTabs.Trigger name="customers">
          <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
          <NativeTabs.Trigger.Label>Customers</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {visible("tasks") && (
        <NativeTabs.Trigger name="tasks">
          <NativeTabs.Trigger.Icon sf={{ default: "checklist", selected: "checklist" }} />
          <NativeTabs.Trigger.Label>Tasks</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {visible("routes") && (
        <NativeTabs.Trigger name="routes">
          <NativeTabs.Trigger.Icon sf={{ default: "sun.max", selected: "sun.max.fill" }} />
          <NativeTabs.Trigger.Label>My Day</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
      {(visible("loads") || visible("map") || visible("orders")) && (
        <NativeTabs.Trigger name="more">
          <NativeTabs.Trigger.Icon sf={{ default: "ellipsis", selected: "ellipsis" }} />
          <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const visible = useVisibleTabs();
  // expo-router classic Tabs auto-renders every file in (tabs) as a tab; the
  // documented way to hide one is `href: null` on Tabs.Screen options.
  const hiddenIfDenied = (name: string) => (visible(name) ? {} : { href: null as never });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 0 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          paddingTop: 6,
          paddingBottom: isWeb ? 0 : insets.bottom,
          height: isWeb ? 84 : 58 + insets.bottom,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
          ...hiddenIfDenied("index"),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: "Customers",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
          ...hiddenIfDenied("customers"),
        }}
      />
      <Tabs.Screen
        name="my-day"
        options={{
          // Merged into the "My Day" (routes) tab; keep the route registered as
          // a redirect target for old links but hide it from the tab bar.
          href: null as never,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="checklist" tintColor={color} size={24} />
            ) : (
              <Feather name="check-square" size={22} color={color} />
            ),
          ...hiddenIfDenied("tasks"),
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: "My Day",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="sun.max" tintColor={color} size={24} />
            ) : (
              <Feather name="sun" size={22} color={color} />
            ),
          ...hiddenIfDenied("routes"),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="ellipsis" tintColor={color} size={24} />
            ) : (
              <Feather name="more-horizontal" size={22} color={color} />
            ),
          href: (visible("loads") || visible("map") || visible("orders")) ? undefined : null as never,
        }}
      />
      <Tabs.Screen
        name="loads"
        options={{
          title: "Loads",
          href: null as never,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          href: null as never,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          href: null as never,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

import { Feather } from "@expo/vector-icons";
import { useClerk } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListMemberRolesQueryKey,
  useListMemberRoles,
} from "@workspace/api-client-react";

import { EntityPicker, type PickedEntity } from "@/components/EntityPicker";
import { ForwardVoiceNoteModal } from "@/components/ForwardVoiceNoteModal";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useBranding } from "@/context/BrandingContext";
import { usePrivacy } from "@/context/PrivacyContext";
import {
  MAPS_APP_OPTIONS,
  setPreferredMapsApp,
  usePreferredMapsApp,
} from "@/lib/navigation";
import {
  type DistanceUnit,
  setDistanceUnit,
  useDistanceUnit,
} from "@/lib/units";
import {
  DeliveryHome,
  FulfillmentHome,
  WarehouseHome,
} from "@/components/OperationalHome";
import ServiceJobsScreen from "@/app/service/index";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";
import {
  normaliseRole,
  pickOperationalRole,
  pickPrimaryRole,
  type RoleKey,
} from "@/lib/roles";
import { setHomeTrack, useHomeTrack } from "@/lib/homeTrack";

// Operational role tracks that get their own real day-runner home (instead of
// the rep dashboard). Each maps to a screen in @/components/OperationalHome and
// a short label for the dual-role switcher. service_tech is handled separately
// below — it has its own day-runner screen too. Adding a new operational track
// is a one-line change here.
const OPERATIONAL_HOMES: Record<
  string,
  { label: string; Screen: React.ComponentType<{ topSlot?: React.ReactNode }> }
> = {
  warehouse: { label: "Warehouse", Screen: WarehouseHome },
  fulfillment: { label: "Fulfillment", Screen: FulfillmentHome },
  delivery_driver: { label: "Delivery", Screen: DeliveryHome },
};

const COLOR_BARS: Record<string, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function HomeScreen() {
  const { currentMember } = useAppAuth();
  // Source of truth for the multi-role model is the join table; fall back to
  // the legacy single role on members.role while we wait for the fetch (or if
  // a member has no member_roles rows yet).
  const memberId = currentMember?.id ?? 0;
  const { data: roles } = useListMemberRoles(memberId, {
    query: {
      enabled: !!currentMember?.id,
      queryKey: getListMemberRolesQueryKey(memberId),
    },
  });
  const fallback = normaliseRole(currentMember?.role);
  const roleKeys: RoleKey[] = roles?.length
    ? roles.map((r) => r.key as RoleKey)
    : [fallback];
  const primary = pickPrimaryRole(roleKeys, fallback);
  if (primary === "service_tech") return <ServiceJobsScreen />;
  const primaryHome = OPERATIONAL_HOMES[primary];
  // Single operational-role member: their home IS the operational day-runner,
  // no switcher.
  if (primaryHome) {
    const { Screen } = primaryHome;
    return <Screen />;
  }
  // Dashboard-home member who ALSO holds an operational role: let them flip
  // their home between the full dashboard and their operational track.
  const opRole = pickOperationalRole(roleKeys);
  if (opRole && OPERATIONAL_HOMES[opRole]) {
    return <DualRoleHome opRole={opRole} />;
  }
  return <RepDashboardScreen />;
}

// Home for a member who lands on the dashboard but also holds an operational
// role. Renders either the full dashboard or the operational stub depending on
// the persisted home-track preference, and threads a switcher into both so they
// can flip back and forth.
function DualRoleHome({ opRole }: { opRole: string }) {
  const track = useHomeTrack();
  const home = OPERATIONAL_HOMES[opRole];
  const switcher = <HomeTrackSwitcher operationalLabel={home.label} />;
  if (track === "operational") {
    const { Screen } = home;
    return <Screen topSlot={switcher} />;
  }
  return <RepDashboardScreen topSlot={switcher} />;
}

function HomeTrackSwitcher({ operationalLabel }: { operationalLabel: string }) {
  const colors = useColors();
  const track = useHomeTrack();
  const options: { key: "dashboard" | "operational"; label: string; icon: "home" | "package" }[] = [
    { key: "dashboard", label: "Dashboard", icon: "home" },
    { key: "operational", label: operationalLabel, icon: "package" },
  ];
  return (
    <View style={[switcherStyles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {options.map((opt) => {
        const active = track === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync();
              setHomeTrack(opt.key);
            }}
            style={[
              switcherStyles.btn,
              { backgroundColor: active ? colors.primary : "transparent" },
            ]}
            testID={`button-home-track-${opt.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Feather
              name={opt.icon}
              size={14}
              color={active ? "#fff" : colors.mutedForeground}
            />
            <Text
              style={[
                switcherStyles.btnText,
                { color: active ? "#fff" : colors.foreground },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RepDashboardScreen({ topSlot }: { topSlot?: React.ReactNode } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const branding = useBranding();
  const { customerMode, toggleCustomerMode } = usePrivacy();
  const { currentMember } = useAppAuth();
  const { canDo } = usePermissions();
  const { signOut } = useClerk();
  const [showProfileSheet, setShowProfileSheet] = useState(false);

  // Voice-message send flow: pick a customer/prospect → record → forward to a teammate.
  const [vmPicking, setVmPicking] = useState(false);
  const [vmEntity, setVmEntity] = useState<PickedEntity | null>(null);
  const [vmActivityId, setVmActivityId] = useState<number | null>(null);
  const [vmForwarding, setVmForwarding] = useState(false);

  const unreadBoardCount = 0;

  const onRefresh = () => {
    // Only keeping this in case other minimal refresh logic is needed.
  };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const initials = currentMember?.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: topPadding + 16, paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Image
            source={
              branding.logoUrl
                ? { uri: branding.logoUrl }
                : require("../../assets/images/longacres-logo.webp")
            }
            style={styles.headerLogo}
            resizeMode="contain"
            accessibilityLabel={branding.name ?? "Company logo"}
          />
          <View style={styles.headerText}>
            <Text style={[styles.greeting, { color: colors.mutedForeground }]}>{today}</Text>
            <Text
              style={[styles.heroName, { color: colors.foreground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {currentMember ? `Hello, ${currentMember.name.split(" ")[0]}` : (branding.name ?? "AcreOps Field")}
            </Text>
          </View>
          <Pressable
            style={[styles.scanIconBtn, { backgroundColor: customerMode ? colors.foreground : colors.accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleCustomerMode();
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: customerMode }}
            accessibilityLabel="Customer mode — hide cost and margin"
          >
            <Feather
              name={customerMode ? "eye-off" : "eye"}
              size={18}
              color={customerMode ? colors.background : colors.accentForeground}
            />
          </Pressable>
          <Pressable
            style={[styles.scanIconBtn, { backgroundColor: colors.accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/voice-inbox");
            }}
            accessibilityLabel="Open your voice inbox"
          >
            <Feather name="inbox" size={18} color={colors.accentForeground} />
          </Pressable>
          <Pressable
            style={[styles.scanIconBtn, { backgroundColor: colors.accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/scan" as never);
            }}
            accessibilityLabel="Scan a product barcode"
          >
            <Feather name="maximize" size={18} color={colors.accentForeground} />
          </Pressable>
          <Pressable
            style={[styles.avatarBtn, { backgroundColor: colors.accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowProfileSheet(true);
            }}
          >
            {initials ? (
              <Text style={[styles.avatarText, { color: colors.accentForeground }]}>{initials}</Text>
            ) : (
              <Feather name="user" size={18} color={colors.mutedForeground} />
            )}
          </Pressable>
        </View>

        {topSlot ? <View style={styles.trackSwitcherWrap}>{topSlot}</View> : null}

        <View style={styles.section}>
          <View style={styles.actionsGrid}>
            {canDo("work_orders.edit") && (
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/order/new");
                }}
              >
                <Feather name="plus-circle" size={24} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                  New Order
                </Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: colors.secondary }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push("/(tabs)/customers");
              }}
            >
              <Feather name="users" size={24} color={colors.secondaryForeground} />
              <Text style={[styles.primaryBtnText, { color: colors.secondaryForeground }]}>
                Customers
              </Text>
            </Pressable>
            {canDo("inventory.view") && (
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/products" as never);
                }}
              >
                <Feather name="box" size={24} color={colors.accentForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.accentForeground }]}>
                  Products
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>More Actions</Text>
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => router.push("/(tabs)/customers")}
            >
              <Feather name="users" size={16} color={colors.primary} />
              <Text
                style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                Customers & Prospects
              </Text>
            </Pressable>
            {canDo("inventory.view") && (
              <Pressable
                style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => router.push("/inventory" as never)}
              >
                <Feather name="archive" size={16} color={colors.primary} />
                <Text
                  style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  Inventory
                </Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => router.push("/service" as never)}
            >
              <Feather name="tool" size={16} color={colors.primary} />
              <Text
                style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                Service Jobs
              </Text>
            </Pressable>
          </View>
          <View style={[styles.actionsRow, { marginTop: 10 }]}>
            <Pressable
              style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setVmActivityId(null);
                setVmEntity(null);
                setVmPicking(true);
              }}
            >
              <Feather name="mic" size={16} color={colors.primary} />
              <Text
                style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                Voice Message
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/board" as never);
              }}
            >
              <View>
                <Feather name="message-square" size={16} color={colors.primary} />
                {unreadBoardCount > 0 ? (
                  <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
                    <Text style={styles.badgeText}>
                      {unreadBoardCount > 9 ? "9+" : String(unreadBoardCount)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                Board
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/sampling" as never);
              }}
            >
              <Feather name="map-pin" size={16} color={colors.primary} />
              <Text
                style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                Sampling
              </Text>
            </Pressable>
          </View>
          {canDo("work_orders.edit") && (
            <View style={[styles.actionsRow, { marginTop: 10 }]}>
              <Pressable
                style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/blend" as never);
                }}
              >
                <Feather name="droplet" size={16} color={colors.primary} />
                <Text
                  style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  New Blend
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtnOutline, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/service-packages" as never);
                }}
              >
                <Feather name="tool" size={16} color={colors.primary} />
                <Text
                  style={[styles.actionBtnOutlineText, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  Service Pkgs
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {showProfileSheet ? (
        <Pressable style={styles.overlay} onPress={() => setShowProfileSheet(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Your Profile</Text>
            {currentMember ? (
              <View style={[styles.profileCard, { backgroundColor: colors.accent }]}>
                <View style={[styles.profileAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.profileAvatarText}>{initials}</Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={[styles.profileName, { color: colors.foreground }]}>{currentMember.name}</Text>
                  {currentMember.role ? (
                    <Text style={[styles.profileRole, { color: colors.mutedForeground }]}>
                      {currentMember.role}
                    </Text>
                  ) : null}
                  {currentMember.email ? (
                    <Text style={[styles.profileEmail, { color: colors.mutedForeground }]}>
                      {currentMember.email}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            <UnitsToggle />
            <MapsAppToggle />
            <Pressable
              style={[styles.commissionBtn, { borderColor: colors.border }]}
              onPress={() => {
                setShowProfileSheet(false);
                router.push("/contact-info" as never);
              }}
              testID="button-my-contact-info"
            >
              <Feather name="user" size={16} color={colors.primary} />
              <Text style={[styles.commissionText, { color: colors.foreground }]}>
                My Contact Info
              </Text>
            </Pressable>
            <Pressable
              style={[styles.commissionBtn, { borderColor: colors.border }]}
              onPress={() => {
                setShowProfileSheet(false);
                router.push("/commission" as never);
              }}
            >
              <Feather name="dollar-sign" size={16} color={colors.primary} />
              <Text style={[styles.commissionText, { color: colors.foreground }]}>
                My Commission
              </Text>
            </Pressable>
            <Pressable
              style={[styles.commissionBtn, { borderColor: colors.border }]}
              onPress={() => {
                setShowProfileSheet(false);
                router.push("/expenses" as never);
              }}
            >
              <Feather name="credit-card" size={16} color={colors.primary} />
              <Text style={[styles.commissionText, { color: colors.foreground }]}>
                My Expenses
              </Text>
            </Pressable>
            <Pressable
              style={[styles.commissionBtn, { borderColor: colors.border }]}
              onPress={() => {
                setShowProfileSheet(false);
                router.push("/allocation-requests" as never);
              }}
            >
              <Feather name="layers" size={16} color={colors.primary} />
              <Text style={[styles.commissionText, { color: colors.foreground }]}>
                Allocation Requests
              </Text>
            </Pressable>
            <Pressable
              style={[styles.signOutBtn, { borderColor: colors.destructive }]}
              onPress={async () => {
                setShowProfileSheet(false);
                await signOut();
              }}
            >
              <Feather name="log-out" size={16} color={colors.destructive} />
              <Text style={[styles.signOutText, { color: colors.destructive }]}>Sign out</Text>
            </Pressable>
            <View style={{ height: insets.bottom + 8 }} />
          </Pressable>
        </Pressable>
      ) : null}

      {/* Voice-message send flow: pick entity → record → forward to teammate. */}
      <EntityPicker
        visible={vmPicking}
        title="Who is this voice message about?"
        entityTypes={["customer", "prospect"]}
        onClose={() => setVmPicking(false)}
        onSelect={(entity) => {
          setVmEntity(entity);
          setVmPicking(false);
        }}
      />

      {vmEntity ? (
        <VoiceNoteRecorder
          entityType={vmEntity.entityType as "customer" | "prospect"}
          entityId={vmEntity.id}
          visible={!!vmEntity && !vmForwarding}
          onClose={() => {
            // If a note was recorded, move on to choosing teammates; otherwise
            // the rep cancelled, so drop the flow entirely.
            if (vmActivityId) {
              setVmForwarding(true);
            } else {
              setVmEntity(null);
            }
          }}
          onSaved={(_text, activityId) => {
            if (activityId) setVmActivityId(activityId);
          }}
        />
      ) : null}

      <ForwardVoiceNoteModal
        visible={vmForwarding}
        voiceNoteId={vmActivityId}
        currentMemberId={currentMember?.id}
        context={(vmEntity?.entityType as "customer" | "prospect") ?? "customer"}
        onClose={() => {
          setVmForwarding(false);
          setVmEntity(null);
          setVmActivityId(null);
        }}
        onSuccess={(count) => {
          setVmForwarding(false);
          setVmEntity(null);
          setVmActivityId(null);
          Alert.alert(
            "Voice message sent",
            `Sent to ${count} teammate${count === 1 ? "" : "s"}.`,
          );
        }}
      />
    </View>
  );
}

function UnitsToggle() {
  const colors = useColors();
  const unit = useDistanceUnit();
  const options: { key: DistanceUnit; label: string }[] = [
    { key: "mi", label: "Miles" },
    { key: "km", label: "Kilometers" },
  ];
  return (
    <View style={unitStyles.wrap}>
      <Text style={[unitStyles.label, { color: colors.mutedForeground }]}>
        Distance unit
      </Text>
      <View style={[unitStyles.row, { borderColor: colors.border }]}>
        {options.map((opt) => {
          const active = unit === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => {
                Haptics.selectionAsync();
                setDistanceUnit(opt.key);
              }}
              style={[
                unitStyles.btn,
                {
                  backgroundColor: active ? colors.primary : "transparent",
                },
              ]}
              testID={`button-distance-unit-${opt.key}`}
            >
              <Text
                style={[
                  unitStyles.btnText,
                  { color: active ? "#fff" : colors.foreground },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MapsAppToggle() {
  const colors = useColors();
  const app = usePreferredMapsApp();
  return (
    <View style={unitStyles.wrap}>
      <Text style={[unitStyles.label, { color: colors.mutedForeground }]}>
        Preferred maps app
      </Text>
      <View style={[unitStyles.row, { borderColor: colors.border }]}>
        {MAPS_APP_OPTIONS.map((opt) => {
          const active = app === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => {
                Haptics.selectionAsync();
                setPreferredMapsApp(opt.key);
              }}
              style={[
                unitStyles.btn,
                {
                  backgroundColor: active ? colors.primary : "transparent",
                },
              ]}
              testID={`button-maps-app-${opt.key}`}
            >
              <Text
                style={[
                  unitStyles.btnText,
                  { color: active ? "#fff" : colors.foreground },
                ]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const switcherStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 20,
    overflow: "hidden",
    padding: 2,
    gap: 2,
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 8,
    borderRadius: 10,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
});

const unitStyles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginTop: 24, gap: 8 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  row: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderRadius: 10,
    overflow: "hidden",
    padding: 2,
  },
  btn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { gap: 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 24,
    gap: 10,
  },
  headerLogo: { width: 40, height: 40, borderRadius: 8 },
  headerText: { flex: 1, gap: 2, minWidth: 0 },
  greeting: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  heroName: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  scanIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  trackSwitcherWrap: { marginBottom: 8 },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  section: { marginBottom: 32 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  seeAll: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actionsGrid: {
    paddingHorizontal: 16,
    gap: 12,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 16,
    gap: 16,
  },
  primaryBtnText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 8,
  },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  actionBtnOutline: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  actionBtnOutlineText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  badge: {
    position: "absolute",
    top: -8,
    right: -12,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: "#fff",
  },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  noteCard: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  noteBar: { width: 6 },
  noteBody: { flex: 1, padding: 16, gap: 8 },
  noteHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  noteAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  noteAvatarText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  noteAuthor: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  noteReplyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  noteReplyText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  moodBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  moodBadgeEmoji: { fontSize: 14 },
  moodBadgeLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noteContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  loading: { paddingHorizontal: 16, fontSize: 15, fontFamily: "Inter_400Regular" },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: 16,
  },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginHorizontal: 20, marginBottom: 20 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 16,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: { color: "#fff", fontSize: 20, fontFamily: "Inter_700Bold" },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  profileRole: { fontSize: 14, fontFamily: "Inter_500Medium" },
  profileEmail: { fontSize: 13, fontFamily: "Inter_400Regular", opacity: 0.8 },
  commissionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  commissionText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 32,
    marginBottom: 20,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  signOutText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});

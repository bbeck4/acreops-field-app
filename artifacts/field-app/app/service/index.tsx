import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetAuthMemberProfile,
  useListWorkItems,
  getListWorkItemsQueryKey,
  type WorkItem,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

// "My day" for service techs. Lists every open service & install job assigned
// to me, plus the ones I closed today. Caches the list so a tech who lost
// signal at the customer's site still sees what they were working on.
const CACHE_KEY = "@agriops:my_service_jobs";

export default function ServiceJobsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { pendingCount } = useOffline();

  const { data: profile } = useGetAuthMemberProfile();

  // Techs default to "my jobs"; everyone else (reps/managers opening tickets)
  // defaults to the full open list. One-shot init once the profile arrives.
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const scopeInitialised = React.useRef(false);
  useEffect(() => {
    if (!profile || scopeInitialised.current) return;
    scopeInitialised.current = true;
    // Multi-role aware: a member holding service_tech (in roleKeys or the
    // legacy role column) keeps the tech default of "my jobs".
    const isTech =
      (profile.roleKeys ?? []).includes("service_tech") ||
      profile.role === "service_tech";
    if (!isTech) setScope("all");
  }, [profile]);

  const svcParams = { kind: "service_job" as const, ...(scope === "mine" ? { assigneeId: profile?.id } : {}) };
  const instParams = { kind: "install_job" as const, ...(scope === "mine" ? { assigneeId: profile?.id } : {}) };
  // Wait for the profile before fetching in either scope so the scope default
  // is settled first — avoids a wrong-scope fetch/cache flash for techs.
  const queriesEnabled = !!profile?.id;
  const { data: serviceJobs, refetch: refetchSvc, isLoading: ls } = useListWorkItems(
    svcParams,
    { query: { enabled: queriesEnabled, queryKey: getListWorkItemsQueryKey(svcParams) } },
  );
  const { data: installJobs, refetch: refetchInst, isLoading: li } = useListWorkItems(
    instParams,
    { query: { enabled: queriesEnabled, queryKey: getListWorkItemsQueryKey(instParams) } },
  );

  const [cached, setCached] = useState<WorkItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Offline cache is namespaced per member + scope so one user's (or scope's)
  // list can never bleed into another's.
  const cacheKey = profile?.id ? `${CACHE_KEY}:${profile.id}:${scope}` : null;
  useEffect(() => {
    setCached([]); // drop the previous scope's rows immediately
    if (!cacheKey) return;
    AsyncStorage.getItem(cacheKey).then((raw) => {
      if (raw) {
        try {
          setCached(JSON.parse(raw));
        } catch {
          // ignore corrupt cache
        }
      }
    });
  }, [cacheKey]);

  const all = useMemo(() => {
    // A successful fetch (even an empty one) is authoritative; the cache is
    // only a stand-in while the network hasn't answered yet (offline/loading).
    if (serviceJobs !== undefined || installJobs !== undefined) {
      const combined = [...(serviceJobs ?? []), ...(installJobs ?? [])];
      if (cacheKey) AsyncStorage.setItem(cacheKey, JSON.stringify(combined)).catch(() => {});
      return combined;
    }
    return cached;
  }, [serviceJobs, installJobs, cached, cacheKey]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const open = all.filter((w) => w.status !== "completed" && w.status !== "cancelled");
  // Sort active phases (en route, on site) to the top of the open list so the
  // tech sees their in-flight job first.
  const phaseOrder = (s: string) => (s === "on_site" || s === "in_progress" ? 0 : s === "en_route" ? 1 : 2);
  open.sort((a, b) => phaseOrder(a.status) - phaseOrder(b.status));
  const doneToday = all.filter(
    (w) => w.status === "completed" && new Date(w.updatedAt).getTime() >= todayStart,
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchSvc(), refetchInst()]);
    setRefreshing(false);
  };

  const isLoading = (ls || li) && all.length === 0;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: insets.top + 8,
      paddingBottom: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 24, fontWeight: "700", color: colors.foreground },
    subtitle: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    newBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    },
    newBtnText: { color: colors.primaryForeground, fontWeight: "600", fontSize: 13 },
    section: { paddingHorizontal: 16, paddingTop: 18 },
    sectionTitle: { fontSize: 13, fontWeight: "600", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
    card: {
      backgroundColor: colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: colors.border, marginBottom: 10,
    },
    cardTitle: { fontSize: 15, fontWeight: "600", color: colors.cardForeground },
    cardSub: { fontSize: 12, color: colors.mutedForeground, marginTop: 4 },
    badge: {
      alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
      backgroundColor: colors.muted, marginTop: 8,
    },
    badgeText: { fontSize: 11, color: colors.mutedForeground, textTransform: "capitalize" },
    pendingBanner: {
      backgroundColor: colors.muted, paddingHorizontal: 16, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    pendingText: { fontSize: 12, color: colors.mutedForeground },
    scopeRow: { flexDirection: "row", gap: 6, marginTop: 10 },
    scopeBtn: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
      backgroundColor: colors.muted,
    },
    scopeBtnText: { fontSize: 13, fontWeight: "600" },
  });

  return (
    <View style={styles.container}>
      <OfflineBanner />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>{scope === "mine" ? "My jobs" : "Service jobs"}</Text>
            <Text style={styles.subtitle}>{open.length} open • {doneToday.length} done today</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={[styles.newBtn, { backgroundColor: colors.muted }]}
              onPress={() => router.push("/service/map" as never)}
              testID="btn-dispatch-map"
            >
              <Feather name="map" size={16} color={colors.primary} />
              <Text style={[styles.newBtnText, { color: colors.primary }]}>Map</Text>
            </Pressable>
            <Pressable style={styles.newBtn} onPress={() => router.push("/service/new" as never)} testID="btn-new-ticket">
              <Feather name="plus" size={16} color={colors.primaryForeground} />
              <Text style={styles.newBtnText}>New ticket</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.scopeRow}>
          {(["mine", "all"] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              style={[styles.scopeBtn, scope === s && { backgroundColor: colors.primary }]}
              testID={`scope-${s}`}
            >
              <Text style={[styles.scopeBtnText, { color: scope === s ? colors.primaryForeground : colors.mutedForeground }]}>
                {s === "mine" ? "My jobs" : "All jobs"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {pendingCount > 0 && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingText}>{pendingCount} write{pendingCount === 1 ? "" : "s"} waiting to sync</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isLoading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Open ({open.length})</Text>
              {open.length === 0 ? (
                <EmptyState icon="check-circle" title="Nothing open" subtitle="You're caught up." />
              ) : (
                open.map((j) => <JobRow key={j.id} job={j} styles={styles} colors={colors} />)
              )}
            </View>
            {doneToday.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Completed today</Text>
                {doneToday.map((j) => <JobRow key={j.id} job={j} styles={styles} colors={colors} />)}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function JobRow({
  job,
  styles,
  colors,
}: {
  job: WorkItem;
  styles: Record<string, any>;
  colors: ReturnType<typeof useColors>;
}) {
  // Surface the active phase prominently so a tech glancing at the list can
  // spot the job they're currently driving to / working without opening it.
  const phase: { label: string; bg: string; fg: string } | null =
    job.status === "en_route"
      ? { label: "En route", bg: "#dbeafe", fg: "#1e40af" }
      : job.status === "on_site" || job.status === "in_progress"
        ? { label: "On site", bg: "#dcfce7", fg: "#166534" }
        : null;
  return (
    <Pressable
      onPress={() => router.push(`/service/${job.id}` as never)}
      style={styles.card}
      testID={`job-${job.id}`}
    >
      <Text style={styles.cardTitle}>{job.summary ?? `Job #${job.id}`}</Text>
      <Text style={styles.cardSub}>
        {job.customerName ?? "—"}
        {job.location ? ` • ${job.location}` : ""}
        {job.dueAt ? ` • due ${new Date(job.dueAt).toLocaleDateString()}` : ""}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {phase && (
          <View style={[styles.badge, { backgroundColor: phase.bg, marginTop: 0 }]}>
            <Text style={[styles.badgeText, { color: phase.fg, fontWeight: "700" }]}>
              {phase.label}
            </Text>
          </View>
        )}
        <View style={[styles.badge, { marginTop: 0 }]}>
          <Text style={styles.badgeText}>
            {job.status} • {job.kind.replace(/_/g, " ")}
          </Text>
        </View>
      </View>
      <View style={{ position: "absolute", right: 14, top: 14 }}>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

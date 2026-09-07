import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Callout, Marker, PROVIDER_DEFAULT } from "@/components/MapShim";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetServiceMap,
  getGetServiceMapQueryKey,
  type ServiceMapJob,
} from "@workspace/api-client-react";

import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { openNavigation } from "@/lib/navigation";

// Service dispatch map for techs: shows my open jobs and (optionally) any
// unassigned nearby jobs so I can see what's around me. Polls every 30s.

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#dc2626",
  high: "#f97316",
  normal: "#2563eb",
  low: "#64748b",
};

type Filter = "mine" | "nearby" | "all";

export default function TechMapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentMember } = useAppAuth();

  const [filter, setFilter] = useState<Filter>("mine");
  const [myLocation, setMyLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  // Ask for foreground location once — the same pattern stop/[id].tsx uses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (!cancelled) setLocError("Location permission denied");
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setMyLocation(pos.coords);
      } catch (e) {
        if (!cancelled) setLocError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, isLoading, refetch, isRefetching } = useGetServiceMap({
    query: { refetchInterval: 30_000, queryKey: getGetServiceMapQueryKey() },
  });

  const allJobs = data?.jobs ?? [];
  const depots = data?.depots ?? [];

  const visibleJobs = useMemo(() => {
    const withCoords = allJobs.filter(
      (j) => j.customerLat != null && j.customerLng != null,
    );
    if (filter === "mine") {
      return withCoords.filter((j) => j.primaryAssigneeId === currentMember?.id);
    }
    if (filter === "nearby") {
      // Mine + any unassigned within 50 miles of me.
      const mine = withCoords.filter((j) => j.primaryAssigneeId === currentMember?.id);
      if (!myLocation) return mine;
      const nearby = withCoords.filter((j) => {
        if (j.primaryAssigneeId != null) return false;
        return haversineMi(myLocation.latitude, myLocation.longitude, j.customerLat!, j.customerLng!) <= 50;
      });
      return [...mine, ...nearby];
    }
    return withCoords;
  }, [allJobs, filter, currentMember, myLocation]);

  const initialRegion = useMemo(() => {
    const pts: Array<{ lat: number; lng: number }> = visibleJobs.map((j) => ({
      lat: j.customerLat!,
      lng: j.customerLng!,
    }));
    if (myLocation) pts.push({ lat: myLocation.latitude, lng: myLocation.longitude });
    if (pts.length === 0) {
      return { latitude: 39.5, longitude: -98.35, latitudeDelta: 30, longitudeDelta: 30 };
    }
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, myLocation]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const openJob = (jobId: number) => {
    router.push({ pathname: "/service/[id]", params: { id: String(jobId) } });
  };

  const openInMaps = (job: ServiceMapJob) => {
    const lat = job.customerLat;
    const lng = job.customerLng;
    if (lat == null || lng == null) return;
    void openNavigation({ lat, lng, label: job.customerName ?? "Service stop" });
  };

  const mineCount = allJobs.filter((j) => j.primaryAssigneeId === currentMember?.id).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Dispatch Map" }} />
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
            style={[styles.refreshBtn, { backgroundColor: colors.muted, marginRight: 10 }]}
            testID="button-back"
          >
            <Feather name="arrow-left" size={16} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Dispatch Map</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {visibleJobs.length} jobs · {mineCount} assigned to me
              {locError ? " · location unavailable" : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => refetch()}
            disabled={isRefetching}
            style={[styles.refreshBtn, { backgroundColor: colors.muted }]}
          >
            <Feather
              name="refresh-cw"
              size={14}
              color={isRefetching ? colors.mutedForeground : colors.primary}
            />
          </Pressable>
        </View>

        <View style={[styles.toggleRow, { backgroundColor: colors.muted }]}>
          {(["mine", "nearby", "all"] as Filter[]).map((f) => (
            <Pressable
              key={f}
              style={[styles.toggleBtn, filter === f && { backgroundColor: colors.card }]}
              onPress={() => setFilter(f)}
            >
              <Text
                style={[
                  styles.toggleBtnText,
                  { color: filter === f ? colors.primary : colors.mutedForeground },
                ]}
              >
                {f === "mine" ? "Mine" : f === "nearby" ? "Nearby" : "All"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {isLoading && !data ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <MapView
            provider={PROVIDER_DEFAULT}
            style={{ flex: 1 }}
            initialRegion={initialRegion}
            showsUserLocation={!!myLocation}
          >
            {depots.map((d) =>
              d.lat != null && d.lng != null ? (
                <Marker
                  key={`depot-${d.id}`}
                  coordinate={{ latitude: d.lat, longitude: d.lng }}
                  pinColor="#475569"
                  title={d.name}
                  description={
                    d.trucks.length > 0
                      ? `${d.trucks.join(", ")}${d.address ? ` · ${d.address}` : ""}`
                      : (d.address ?? undefined)
                  }
                />
              ) : null,
            )}
            {visibleJobs.map((j) => (
              <Marker
                key={`job-${j.id}`}
                coordinate={{ latitude: j.customerLat!, longitude: j.customerLng! }}
                pinColor={PRIORITY_COLORS[j.priority] ?? PRIORITY_COLORS.normal}
                tracksViewChanges={false}
              >
                <Callout onPress={() => openJob(j.id)}>
                  <View style={{ minWidth: 200, padding: 4 }}>
                    <Text style={{ fontWeight: "600", fontSize: 14 }}>
                      {j.customerName ?? "Service stop"}
                    </Text>
                    <Text style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      {j.priority.toUpperCase()} · {j.status.replace(/_/g, " ")}
                    </Text>
                    {j.summary ? (
                      <Text style={{ fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                        {j.summary}
                      </Text>
                    ) : null}
                    {j.dueAt ? (
                      <Text style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        Due {new Date(j.dueAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
                      <Pressable
                        onPress={() => openJob(j.id)}
                        style={{ backgroundColor: "#2563eb", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 }}
                      >
                        <Text style={{ color: "white", fontSize: 12, fontWeight: "600" }}>Open</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => openInMaps(j)}
                        style={{ backgroundColor: "#16a34a", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 }}
                      >
                        <Text style={{ color: "white", fontSize: 12, fontWeight: "600" }}>Navigate</Text>
                      </Pressable>
                    </View>
                  </View>
                </Callout>
              </Marker>
            ))}
          </MapView>
        )}
      </View>
    </View>
  );
}

function haversineMi(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
  refreshBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  toggleRow: { flexDirection: "row", borderRadius: 8, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, paddingVertical: 6, alignItems: "center", borderRadius: 6 },
  toggleBtnText: { fontSize: 12, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});

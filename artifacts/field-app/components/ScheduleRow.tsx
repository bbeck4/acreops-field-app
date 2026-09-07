import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { type WorkItem } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { canNavigate, openNavigation } from "@/lib/navigation";

// Mirrors the server haversine formula for client-side drive-time estimation.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Open directions via the shared maps hand-off (respects the rep's preferred
// maps app with graceful fallback to the platform default).
export function openNav(opts: {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
}) {
  if (!canNavigate(opts)) {
    Alert.alert("No location", "This job has no address or coordinates to navigate to.");
    return;
  }
  void openNavigation(opts);
}

export const fmtDrive = (mins: number) => {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export const fmtWindow = (start?: string | null, end?: string | null) => {
  if (!start && !end) return "Unscheduled";
  if (start && end) return `${fmtTime(start)} – ${fmtTime(end)}`;
  return fmtTime(start ?? end);
};

export const statusBadge = (status: string): { bg: string; fg: string; label: string } => {
  switch (status) {
    case "en_route":
      return { bg: "#dbeafe", fg: "#1e40af", label: "En route" };
    case "on_site":
    case "in_progress":
      return { bg: "#dcfce7", fg: "#166534", label: "On site" };
    case "completed":
      return { bg: "#e5e7eb", fg: "#374151", label: "Done" };
    case "cancelled":
      return { bg: "#fee2e2", fg: "#991b1b", label: "Cancelled" };
    default:
      return { bg: "#f3f4f6", fg: "#4b5563", label: status.replace(/_/g, " ") };
  }
};

// One scheduled service / install job row in the "My Day" schedule. Tapping it
// opens the job detail / check-in flow.
export function ScheduleRow({
  job,
  colors,
}: {
  job: WorkItem;
  colors: ReturnType<typeof useColors>;
}) {
  const badge = statusBadge(job.status);
  const start = job.scheduledWindowStart as unknown as string | null | undefined;
  const end = job.scheduledWindowEnd as unknown as string | null | undefined;
  const styles = makeStyles(colors);
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/service/${job.id}` as never)}
      testID={`my-day-job-${job.id}`}
    >
      <View style={styles.timeCol}>
        {start ? (
          <>
            <Text style={styles.timeStart}>{fmtTime(start)}</Text>
            {end ? <Text style={styles.timeEnd}>– {fmtTime(end)}</Text> : null}
          </>
        ) : (
          <Text style={styles.timeStart}>—</Text>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {job.summary ?? `Job #${job.id}`}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {job.customerName ?? "—"}
          {job.location ? ` • ${job.location}` : ""}
        </Text>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>
              {job.kind === "install_job" ? "Install" : "Service"}
            </Text>
          </View>
          {job.priority && job.priority !== "normal" ? (
            <View style={[styles.badge, { backgroundColor: job.priority === "urgent" ? "#fee2e2" : "#fef3c7" }]}>
              <Text style={[styles.badgeText, { color: job.priority === "urgent" ? "#991b1b" : "#92400e" }]}>
                {job.priority}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} style={styles.chevron} />
    </Pressable>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 12,
    },
    timeCol: { width: 64, alignItems: "flex-start" },
    timeStart: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground },
    timeEnd: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginTop: 2 },
    body: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.cardForeground },
    rowSub: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginTop: 4 },
    badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    chevron: { alignSelf: "center" },
  });
}

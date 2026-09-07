import { Feather } from "@expo/vector-icons";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline, type PendingWrite } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

// ─── Human-readable labels ────────────────────────────────────────────────────

const TYPE_LABELS: Record<PendingWrite["type"], string> = {
  activity: "Activity log",
  workOrder: "Work order",
  servicePackageOrder: "Service quote",
  reassignRouteStops: "Route reorder",
  addRouteStop: "Add stop",
  updateRouteStop: "Edit stop",
  checkInRouteStop: "Check in",
  deleteRouteStop: "Remove stop",
  completeDeliveryStop: "Delivery stop",
  deliveryIncident: "Delivery incident",
  serviceJobComplete: "Job complete",
  serviceJobEnRoute: "En route",
  serviceJobOnSite: "On site",
  serviceJobUpdate: "Job update",
  serviceJobPartsUpdate: "Parts update",
  serviceLaborStart: "Labor start",
  serviceLaborStop: "Labor stop",
  serviceLaborStopForQueuedStart: "Labor stop",
  sampleTransition: "Sample collected",
  samplingPlan: "Sampling plan",
  samplingAddPoint: "Sample point",
  samplingGrid: "Sampling grid",
};

type FeatherName = React.ComponentProps<typeof Feather>["name"];

const TYPE_ICONS: Record<PendingWrite["type"], FeatherName> = {
  activity: "edit-2",
  workOrder: "file-text",
  servicePackageOrder: "tool",
  reassignRouteStops: "shuffle",
  addRouteStop: "map-pin",
  updateRouteStop: "edit-3",
  checkInRouteStop: "check-circle",
  deleteRouteStop: "trash-2",
  completeDeliveryStop: "truck",
  deliveryIncident: "alert-triangle",
  serviceJobComplete: "check-circle",
  serviceJobEnRoute: "navigation",
  serviceJobOnSite: "home",
  serviceJobUpdate: "edit",
  serviceJobPartsUpdate: "package",
  serviceLaborStart: "play",
  serviceLaborStop: "square",
  serviceLaborStopForQueuedStart: "square",
  sampleTransition: "droplet",
  samplingPlan: "crosshair",
  samplingAddPoint: "map-pin",
  samplingGrid: "grid",
};

// ─── Summary extraction (best-effort) ─────────────────────────────────────────

function writeSummary(write: PendingWrite): string {
  const p = write.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return "";
  switch (write.type) {
    case "addRouteStop":
      return String(p.customerName ?? p.prospectName ?? "");
    case "updateRouteStop":
      return String(p.name ?? p.stopName ?? "");
    case "deleteRouteStop": {
      const name = p.stopName as string | null | undefined;
      const route = p.routeName as string | null | undefined;
      return [name, route ? `from ${route}` : ""].filter(Boolean).join(" ");
    }
    case "checkInRouteStop": {
      const name = p.customerName as string | null | undefined;
      const route = p.routeName as string | null | undefined;
      return [name, route ? `on ${route}` : ""].filter(Boolean).join(" ");
    }
    case "activity": {
      const subject = p.subject as string | null | undefined;
      return subject ?? (p.customerId ? `Customer ${p.customerId}` : "");
    }
    case "workOrder":
      return p.customerId ? `Customer ${p.customerId}` : "";
    case "reassignRouteStops":
      return "Updated stop order";
    case "samplingPlan":
      return String(p.name ?? "");
    case "samplingGrid":
      return p.cellAcres ? `${p.cellAcres} ac cells` : "";
    case "completeDeliveryStop":
    case "deliveryIncident":
      return p.stopId ? `Stop #${p.stopId}` : "";
    case "serviceJobComplete":
    case "serviceJobEnRoute":
    case "serviceJobOnSite":
    case "serviceJobUpdate":
    case "serviceJobPartsUpdate":
    case "serviceLaborStart":
    case "serviceLaborStop":
    case "serviceLaborStopForQueuedStart": {
      const id = p.workItemId as number | undefined;
      return id ? `Job #${id}` : "";
    }
    default:
      return "";
  }
}

// ─── Age formatting ────────────────────────────────────────────────────────────

function formatAge(createdAt: number): string {
  const diff = Date.now() - createdAt;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Single queue entry row ────────────────────────────────────────────────────

function WriteRow({
  write,
  onRetry,
  onDiscard,
  isSyncing,
  isBlocked,
  colors,
}: {
  write: PendingWrite;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  isSyncing: boolean;
  isBlocked: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const isFailed = !!write.failedReason;
  const summary = writeSummary(write);
  const icon: FeatherName = TYPE_ICONS[write.type] ?? "upload-cloud";

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: isFailed ? colors.destructive + "30" : colors.border,
          borderWidth: isFailed ? 1 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: isFailed ? colors.destructive + "15" : colors.muted },
        ]}
      >
        <Feather
          name={icon}
          size={16}
          color={isFailed ? colors.destructive : colors.primary}
        />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text style={[styles.rowType, { color: colors.foreground }]}>
            {TYPE_LABELS[write.type] ?? write.type}
          </Text>
          <Text style={[styles.rowAge, { color: colors.mutedForeground }]}>
            {formatAge(write.createdAt)}
          </Text>
        </View>

        {summary ? (
          <Text
            style={[styles.rowSummary, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {summary}
          </Text>
        ) : null}

        {isFailed ? (
          <View style={styles.failedBadgeRow}>
            <View style={[styles.failedBadge, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="alert-circle" size={10} color={colors.destructive} />
              <Text style={[styles.failedBadgeText, { color: colors.destructive }]}>Failed</Text>
            </View>
            {write.failedReason ? (
              <Text
                style={[styles.failedReason, { color: colors.destructive }]}
                numberOfLines={2}
              >
                {write.failedReason}
              </Text>
            ) : null}
          </View>
        ) : isSyncing ? (
          <View style={styles.waitingBadgeRow}>
            <View style={[styles.waitingBadge, { backgroundColor: colors.accent }]}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.waitingBadgeText, { color: colors.primary }]}>
                Syncing
              </Text>
            </View>
          </View>
        ) : isBlocked ? (
          <View style={styles.waitingBadgeRow}>
            <View
              style={[
                styles.blockedBadge,
                { backgroundColor: colors.warningBackground ?? colors.muted },
              ]}
            >
              <Feather name="link" size={10} color={colors.warning ?? colors.mutedForeground} />
              <Text
                style={[
                  styles.blockedBadgeText,
                  { color: colors.warning ?? colors.mutedForeground },
                ]}
              >
                Blocked
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.waitingBadgeRow}>
            <View
              style={[
                styles.waitingBadge,
                { backgroundColor: colors.accent + "30" },
              ]}
            >
              <Feather name="clock" size={10} color={colors.accentForeground} />
              <Text
                style={[styles.waitingBadgeText, { color: colors.accentForeground }]}
              >
                Waiting
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.rowActions}>
        {isSyncing ? (
          <ActivityIndicator
            size="small"
            color={colors.primary}
            accessibilityLabel={`Syncing ${summary || TYPE_LABELS[write.type] || write.type}`}
          />
        ) : isFailed ? (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}
            onPress={() => onRetry(write.id)}
            accessibilityRole="button"
            accessibilityLabel={`Retry ${summary || TYPE_LABELS[write.type] || write.type}`}
          >
            <Feather name="refresh-cw" size={13} color={colors.primary} />
          </Pressable>
        ) : null}
        {!isSyncing && (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: colors.muted }]}
            onPress={() => onDiscard(write.id)}
            accessibilityRole="button"
            accessibilityLabel={`Discard ${summary || TYPE_LABELS[write.type] || write.type}`}
            accessibilityHint="Removes this saved offline change permanently"
          >
            <Feather name="trash-2" size={13} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

export function PendingSyncTray() {
  const {
    trayOpen,
    closeTray,
    pendingWrites,
    queueWarning,
    retryItem,
    discardItem,
    triggerFlush,
    isOnline,
    syncingWriteIds,
  } = useOffline();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const handleRetry = useCallback(
    async (id: string) => {
      await retryItem(id);
    },
    [retryItem],
  );

  const handleDiscard = useCallback(
    async (id: string) => {
      await discardItem(id);
    },
    [discardItem],
  );

  const handleRetryAll = useCallback(() => {
    triggerFlush();
  }, [triggerFlush]);

  const failedCount = pendingWrites.filter((w) => w.failedReason).length;
  const syncingCount = syncingWriteIds.filter((id) =>
    pendingWrites.some((write) => write.id === id),
  ).length;
  const waitingCount = Math.max(0, pendingWrites.length - failedCount - syncingCount);
  const pendingIds = new Set(pendingWrites.map((write) => write.id));

  return (
    <Modal
      visible={trayOpen}
      transparent
      animationType="slide"
      onRequestClose={closeTray}
    >
      <Pressable style={styles.overlay} onPress={closeTray} />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            paddingBottom: insets.bottom + 16,
          },
        ]}
        accessibilityViewIsModal
      >
        {/* Header */}
        <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
          <View style={styles.sheetTitleRow}>
            <View style={styles.sheetTitleLeft}>
              <Feather
                name="upload-cloud"
                size={17}
                color={colors.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                Pending Sync
              </Text>
              {pendingWrites.length > 0 && (
                <View
                  style={[
                    styles.countBadge,
                    { backgroundColor: colors.muted },
                  ]}
                >
                  <Text
                    style={[styles.countBadgeText, { color: colors.mutedForeground }]}
                  >
                    {pendingWrites.length}
                  </Text>
                </View>
              )}
            </View>

            <Pressable
              style={styles.closeBtn}
              onPress={closeTray}
              accessibilityRole="button"
              accessibilityLabel="Close pending sync"
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Summary row */}
          <View style={styles.summaryRow}>
            {!isOnline && (
              <View
                style={[
                  styles.offlinePill,
                  { backgroundColor: colors.warningBackground },
                ]}
              >
                <Feather name="wifi-off" size={11} color={colors.warning} />
                <Text style={[styles.offlinePillText, { color: colors.warning }]}>
                  Offline
                </Text>
              </View>
            )}
            {failedCount > 0 && (
              <Text style={[styles.summaryText, { color: colors.destructive }]}>
                {failedCount} failed
              </Text>
            )}
            {waitingCount > 0 && (
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
                {waitingCount} waiting
              </Text>
            )}
            {syncingCount > 0 && (
              <Text
                style={[styles.summaryText, { color: colors.primary }]}
                accessibilityLiveRegion="polite"
              >
                {syncingCount} syncing
              </Text>
            )}
            {pendingWrites.length === 0 && (
              <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
                All clear
              </Text>
            )}
          </View>
        </View>

        {/* Queue warning banner — shown when corrupt/quarantined/unsupported entries exist */}
        {queueWarning ? (
          <View
            style={[
              styles.warningBanner,
              { backgroundColor: colors.warningBackground, borderColor: colors.warning + "40" },
            ]}
          >
            <Feather name="alert-triangle" size={13} color={colors.warning} style={{ flexShrink: 0 }} />
            <Text style={[styles.warningBannerText, { color: colors.warning }]} numberOfLines={3}>
              {queueWarning}
            </Text>
          </View>
        ) : null}

        {/* Actions bar */}
        {pendingWrites.length > 0 && (
          <View style={[styles.actionsBar, { borderBottomColor: colors.border }]}>
            <Pressable
              style={[
                styles.retryAllBtn,
                {
                  backgroundColor: isOnline ? colors.primary : colors.muted,
                  opacity: isOnline ? 1 : 0.6,
                },
              ]}
              onPress={handleRetryAll}
              disabled={!isOnline}
              accessibilityRole="button"
              accessibilityLabel="Retry all pending changes"
              accessibilityState={{ disabled: !isOnline }}
            >
              <Feather
                name="refresh-cw"
                size={13}
                color={isOnline ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.retryAllText,
                  { color: isOnline ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Retry all
              </Text>
            </Pressable>
          </View>
        )}

        {/* List */}
        {pendingWrites.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="check-circle" size={36} color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Nothing pending
            </Text>
            <Text style={[styles.emptyMsg, { color: colors.mutedForeground }]}>
              All your changes have synced to the server.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {pendingWrites.map((write) => (
              <WriteRow
                key={write.id}
                write={write}
                onRetry={handleRetry}
                onDiscard={handleDiscard}
                isSyncing={syncingWriteIds.includes(write.id)}
                isBlocked={
                  !write.failedReason &&
                  !!write.dependsOn &&
                  pendingIds.has(write.dependsOn)
                }
                colors={colors}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  sheetHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitleLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  countBadge: {
    marginLeft: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  summaryText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  offlinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  offlinePillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  actionsBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  retryAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 44,
    borderRadius: 8,
  },
  retryAllText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    gap: 8,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  emptyMsg: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    maxWidth: 220,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    gap: 3,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  rowType: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  rowAge: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flexShrink: 0,
  },
  rowSummary: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  failedBadgeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 2,
    flexWrap: "wrap",
  },
  failedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  failedBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  failedReason: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  waitingBadgeRow: {
    marginTop: 2,
  },
  waitingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  waitingBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningBannerText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 17,
  },
  blockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  blockedBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
});

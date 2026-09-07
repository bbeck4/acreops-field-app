import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import {
  useListTasks,
  useListWorkItems,
  getListWorkItemsQueryKey,
  type Task,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { TaskCard } from "@/components/TaskCard";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";
import { TaskFormSheet } from "./TaskFormSheet";

type FilterStatus = "todo" | "in_progress" | "done" | "all";
const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "Open", value: "todo" },
  { label: "In Progress", value: "in_progress" },
  { label: "Done", value: "done" },
  { label: "All", value: "all" },
];

interface Props {
  mineOnly: boolean;
}

export function TasksView({ mineOnly }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const { isOnline } = useOffline();
  const { canDo } = usePermissions();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("todo");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch all tasks; mine-only filtering is done client-side so organization tasks
  // (visible to the entire team) are always included in the "mine" view.
  const queryParams = {};

  const { data: liveTasks, isLoading, refetch, isRefetching } = useListTasks(queryParams);
  const allTasks = useOfflineCache("tasks", liveTasks, !isOnline);

  // When mine-only: include tasks assigned to me OR assigned to the entire team.
  const tasks = useMemo(() => {
    if (!mineOnly || !currentMember) return allTasks ?? [];
    return (allTasks ?? []).filter(
      (task) =>
        task.visibility === "organization" ||
        task.assigneeId === currentMember.id,
    );
  }, [allTasks, mineOnly, currentMember]);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => filterStatus === "all" || taskStatusBucket(task.status) === filterStatus),
    [tasks, filterStatus],
  );

  const serviceParams = {
    kind: "service_job",
    ...(mineOnly && currentMember ? { assigneeId: currentMember.id } : {}),
  };
  const { data: liveServiceJobs, refetch: refetchServiceJobs, isRefetching: isRefetchingService } = useListWorkItems(
    serviceParams,
    { query: { queryKey: getListWorkItemsQueryKey(serviceParams) } },
  );
  const serviceJobs = useOfflineCache("tasks_service_jobs", liveServiceJobs, !isOnline);

  const serviceItems = useMemo(() => {
    return (serviceJobs ?? [])
      .map((j) => ({
        id: j.id,
        title: j.summary ?? `Job #${j.id}`,
        bucket: serviceStatusBucket(j.status),
        priority: j.priority ?? null,
        dueDate: j.dueAt ?? j.scheduledWindowStart ?? null,
        customerName: j.customerName ?? null,
      }))
      .filter((it) => filterStatus === "all" || it.bucket === filterStatus);
  }, [serviceJobs, filterStatus]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetch(), refetchServiceJobs()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <>
      <View style={styles.filterSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          {STATUS_FILTERS.map((f) => (
            <Pressable
              key={f.value}
              style={[
                styles.pill,
                {
                  borderColor: colors.border,
                  backgroundColor: filterStatus === f.value ? colors.primary : colors.card,
                },
              ]}
              onPress={() => setFilterStatus(f.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: filterStatus === f.value }}
              accessibilityLabel={`Filter by ${f.label}`}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: filterStatus === f.value ? "#fff" : colors.mutedForeground },
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing || isRefetching || isRefetchingService}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading && !tasks ? (
          <Text style={[styles.loading, { color: colors.mutedForeground }]}>Loading…</Text>
        ) : !visibleTasks.length && !serviceItems.length ? (
          <EmptyState
            icon="check-circle"
            title="No tasks found"
            subtitle={
              filterStatus === "done"
                ? "Complete some tasks to see them here"
                : "Nothing open right now"
            }
          />
        ) : (
          <View style={styles.list}>
            {visibleTasks.map((task) => (
              <TaskCard
                key={`task-${task.id}`}
                title={task.title}
                status={task.status}
                priority={task.priority}
                dueDate={task.dueDate ?? null}
                projectName={task.projectName}
                visibility={task.visibility}
                sharedMemberCount={task.sharedMemberIds?.length ?? 0}
                onPress={
                  canDo("tasks.edit")
                    ? () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setEditingTask(task);
                      }
                    : undefined
                }
              />
            ))}
            {serviceItems.map((job) => (
              <TaskCard
                key={`service-${job.id}`}
                title={job.title}
                status={job.bucket}
                priority={job.priority}
                dueDate={job.dueDate}
                projectName={job.customerName ? `Service · ${job.customerName}` : "Service job"}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/service/${job.id}` as never);
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <TaskFormSheet
        visible={editingTask != null}
        task={editingTask}
        onClose={() => setEditingTask(null)}
      />
    </>
  );
}

function serviceStatusBucket(status: string): FilterStatus {
  if (status === "completed" || status === "cancelled") return "done";
  if (status === "en_route" || status === "on_site" || status === "in_progress") {
    return "in_progress";
  }
  return "todo";
}

function taskStatusBucket(status: string): Exclude<FilterStatus, "all"> {
  const normalized = status.trim().toLowerCase().replaceAll(" ", "_");
  if (normalized === "done" || normalized === "completed") return "done";
  if (normalized === "in_progress" || normalized === "review") return "in_progress";
  return "todo";
}

const styles = StyleSheet.create({
  filterSection: { marginBottom: 16 },
  pillRow: { paddingHorizontal: 20, gap: 8, flexDirection: "row" },
  pill: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  list: { gap: 0, paddingHorizontal: 0 },
  loading: { paddingHorizontal: 20, fontSize: 15, fontFamily: "Inter_400Regular" },
});

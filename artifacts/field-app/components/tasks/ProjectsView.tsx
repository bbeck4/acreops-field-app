import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState, useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useListProjects,
  type Project,
} from "@workspace/api-client-react";
import { useOffline } from "@/context/OfflineContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useAppAuth } from "@/context/AuthContext";
import { usePermissions } from "@/lib/permissions";
import { useColors } from "@/hooks/useColors";

import { EmptyState } from "@/components/EmptyState";
import { ProjectCard } from "./ProjectCard";
import { ProjectFormSheet } from "./ProjectFormSheet";

type FilterStatus = "open" | "on_hold" | "completed" | "all";
const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "Open", value: "open" },
  { label: "On Hold", value: "on_hold" },
  { label: "Completed", value: "completed" },
  { label: "All", value: "all" },
];

interface Props {
  mineOnly: boolean;
}

export function ProjectsView({ mineOnly }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const { isOnline } = useOffline();
  const { canDo } = usePermissions();

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("open");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: liveProjects, isLoading, isRefetching, refetch } = useListProjects();
  const allProjects = useOfflineCache("projects", liveProjects, !isOnline);

  const projects = useMemo(() => {
    if (!allProjects) return [];
    return allProjects.filter((p) => {
      if (filterStatus !== "all" && projectStatusBucket(p.status) !== filterStatus) return false;
      if (mineOnly && currentMember) {
        const isOwner = p.ownerId === currentMember.id;
        const isShared = p.sharedMemberIds?.includes(currentMember.id);
        if (!isOwner && !isShared) return false;
      }
      return true;
    });
  }, [allProjects, filterStatus, mineOnly, currentMember]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
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
            refreshing={isRefreshing || isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading && !allProjects ? (
          <Text style={[styles.loading, { color: colors.mutedForeground }]}>Loading…</Text>
        ) : !projects.length ? (
          <EmptyState
            icon="folder"
            title="No projects found"
            subtitle={
              filterStatus === "completed"
                ? "Complete some projects to see them here"
                : "Nothing active right now"
            }
          />
        ) : (
          <View style={styles.list}>
            {projects.map((project) => (
              <ProjectCard
                key={`project-${project.id}`}
                title={project.name}
                status={project.status}
                dueDate={project.dueDate}
                ownerName={project.ownerName}
                visibility={project.visibility}
                sharedMemberCount={project.sharedMemberIds?.length ?? 0}
                taskCount={project.taskCount}
                completedTaskCount={project.completedTaskCount}
                onPress={
                  canDo("projects.edit")
                    ? () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setEditingProject(project);
                      }
                    : undefined
                }
              />
            ))}
          </View>
        )}
      </ScrollView>

      <ProjectFormSheet
        visible={editingProject != null}
        project={editingProject}
        onClose={() => setEditingProject(null)}
      />
    </>
  );
}

function projectStatusBucket(status: string): Exclude<FilterStatus, "all"> {
  const normalized = status.trim().toLowerCase().replaceAll("_", " ");
  if (normalized === "completed" || normalized === "done" || normalized === "cancelled") {
    return "completed";
  }
  if (normalized === "on hold") return "on_hold";
  return "open";
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

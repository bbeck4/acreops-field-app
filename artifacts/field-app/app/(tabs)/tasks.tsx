import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";
import { TasksView } from "@/components/tasks/TasksView";
import { ProjectsView } from "@/components/tasks/ProjectsView";
import { TaskFormSheet } from "@/components/tasks/TaskFormSheet";
import { ProjectFormSheet } from "@/components/tasks/ProjectFormSheet";

export default function TasksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { canDo } = usePermissions();
  const [mineOnly, setMineOnly] = useState(true);

  const [viewType, setViewType] = useState<"tasks" | "projects">("tasks");

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {viewType === "tasks" ? "Tasks" : "Projects"}
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[
                styles.toggleBtn,
                { borderColor: colors.border, backgroundColor: mineOnly ? colors.accent : colors.card },
              ]}
              onPress={() => setMineOnly((v) => !v)}
              accessibilityRole="switch"
              accessibilityLabel="Show only my tasks and projects"
              accessibilityState={{ checked: mineOnly }}
            >
              <Feather name="user" size={14} color={mineOnly ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleText, { color: mineOnly ? colors.primary : colors.mutedForeground }]}>
                {mineOnly ? "Mine" : "All"}
              </Text>
            </Pressable>
            {canDo(viewType === "tasks" ? "tasks.edit" : "projects.edit") && (
              <Pressable
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (viewType === "tasks") {
                    setShowTaskForm(true);
                  } else {
                    setShowProjectForm(true);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={viewType === "tasks" ? "Create new task" : "Create new project"}
              >
                <Feather name="plus" size={18} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>

        <View style={[styles.segmentedControl, { backgroundColor: colors.muted }]}>
          <Pressable
            style={[
              styles.segment,
              viewType === "tasks" && [styles.segmentActive, { backgroundColor: colors.card, shadowColor: "#000" }],
            ]}
            onPress={() => {
              setViewType("tasks");
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: viewType === "tasks" }}
            accessibilityLabel="Show tasks"
          >
            <Text
              style={[
                styles.segmentText,
                { color: viewType === "tasks" ? colors.foreground : colors.mutedForeground },
              ]}
            >
              Tasks
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.segment,
              viewType === "projects" && [styles.segmentActive, { backgroundColor: colors.card, shadowColor: "#000" }],
            ]}
            onPress={() => {
              setViewType("projects");
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: viewType === "projects" }}
            accessibilityLabel="Show projects"
          >
            <Text
              style={[
                styles.segmentText,
                { color: viewType === "projects" ? colors.foreground : colors.mutedForeground },
              ]}
            >
              Projects
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>
        {viewType === "tasks" ? <TasksView mineOnly={mineOnly} /> : <ProjectsView mineOnly={mineOnly} />}
      </View>

      <TaskFormSheet visible={showTaskForm} onClose={() => setShowTaskForm(false)} />
      <ProjectFormSheet visible={showProjectForm} onClose={() => setShowProjectForm(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 16,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  toggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentedControl: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  content: {
    flex: 1,
  },
});

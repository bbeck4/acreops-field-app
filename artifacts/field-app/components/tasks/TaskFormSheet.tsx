import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useListMembers,
  useListProjects,
  getListTasksQueryKey,
  getListProjectsQueryKey,
  type Task,
  type TaskInput,
  type TaskUpdate,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAppAuth } from "@/context/AuthContext";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { MemberPickerSheet } from "./MemberPickerSheet";
import { ProjectPickerSheet } from "./ProjectPickerSheet";
import { StatusPickerModal } from "./StatusPickerModal";
import {
  assignmentFromTask,
  deriveVisibilityAndAssignee,
  canChangeAssignment as canChangeAssignmentFn,
  assignmentLabel as getAssignmentLabel,
  type AssignmentMode,
} from "@/lib/taskAssignment";

type Priority = "low" | "medium" | "high";
const PRIORITIES: Priority[] = ["low", "medium", "high"];

interface Props {
  visible: boolean;
  task?: Task | null;
  onClose: () => void;
}

export function TaskFormSheet({ visible, task, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const queryClient = useQueryClient();
  const { data: allMembers } = useListMembers();
  const { data: projects } = useListProjects();

  // Only active members in the assignment picker
  const activeMembers = React.useMemo(
    () => (allMembers ?? []).filter((m) => m.isActive),
    [allMembers],
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState("todo");
  const [dueDate, setDueDate] = useState("");
  const [assignment, setAssignment] = useState<AssignmentMode>(() =>
    assignmentFromTask(null, currentMember?.id),
  );
  const [projectId, setProjectId] = useState<number | null>(null);
  const [sharedMemberIds, setSharedMemberIds] = useState<number[]>([]);

  const [showAssignmentPicker, setShowAssignmentPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showSharePicker, setShowSharePicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const { mutateAsync: createTask, isPending: isCreating } = useCreateTask();
  const { mutateAsync: updateTask, isPending: isUpdating } = useUpdateTask();
  const { mutateAsync: deleteTask, isPending: isDeleting } = useDeleteTask();
  const isSaving = isCreating || isUpdating || isDeleting;

  React.useEffect(() => {
    if (visible && task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setPriority(normalizePriority(task.priority));
      setStatus(normalizeTaskStatus(task.status));
      setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
      setAssignment(assignmentFromTask(task, currentMember?.id));
      setProjectId(task.projectId ?? null);
      setSharedMemberIds(task.sharedMemberIds || []);
    } else if (visible && !task) {
      resetForm();
    }
  }, [visible, task]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setStatus("todo");
    setDueDate("");
    setAssignment(assignmentFromTask(null, currentMember?.id));
    setProjectId(null);
    setSharedMemberIds([]);
  };

  const isOwner = task ? task.ownerId === currentMember?.id : true;
  // Visibility (org vs private) can only be changed by the owner.
  const canChangeAssign = canChangeAssignmentFn(task, currentMember?.id);
  // Share picker is only relevant when visibility is private and owner can manage.
  const isEntireTeam = assignment.kind === "team";
  const canManageSharing = !task || (isOwner && task.visibility === "private" && !isEntireTeam);

  const submit = async () => {
    if (!title.trim() || isSaving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const { visibility, assigneeId } = deriveVisibilityAndAssignee(assignment);
      const commonData = {
        title: title.trim(),
        priority,
        status,
      };

      if (task) {
        const data: TaskUpdate = {
          ...commonData,
          description: description.trim() || null,
          dueDate: dueDate.trim() || null,
          projectId,
          ...(isOwner
            ? {
                visibility,
                assigneeId,
                sharedMemberIds: isEntireTeam ? [] : sharedMemberIds,
              }
            : {}),
        };
        await updateTask({ id: task.id, data });
      } else {
        const data: TaskInput = {
          ...commonData,
          description: description.trim() || undefined,
          visibility,
          assigneeId: assigneeId ?? undefined,
          dueDate: dueDate.trim() || undefined,
          projectId: projectId ?? undefined,
          sharedMemberIds: isEntireTeam ? [] : sharedMemberIds,
        };
        await createTask({ data });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
      resetForm();
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      if (projectId || task?.projectId) {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      }
    } catch {
      Alert.alert("Error", `Could not ${task ? "update" : "create"} task. Please try again.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleDelete = () => {
    if (!task) return;
    Alert.alert("Delete Task", "Are you sure you want to delete this task?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          try {
            await deleteTask({ id: task.id });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onClose();
            queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
            if (task.projectId) {
              queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            }
          } catch {
            Alert.alert("Error", "Could not delete task.");
          }
        },
      },
    ]);
  };

  if (!visible) return null;

  const assignmentLabel = getAssignmentLabel(
    assignment,
    (id) => activeMembers.find((m) => m.id === id)?.name,
  );

  const assignmentIcon: "globe" | "user" | "user-x" =
    assignment.kind === "team" ? "globe" : assignment.kind === "member" ? "user" : "user-x";

  const projectName = projects?.find((p) => p.id === projectId)?.name ?? "None";

  return (
    <>
      <Pressable style={styles.overlay} onPress={() => { onClose(); resetForm(); }}>
        <KeyboardAwareScrollViewCompat
          style={styles.keyboardScroll}
          contentContainerStyle={styles.keyboardContent}
          bottomOffset={insets.bottom + 84}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 12) + 20,
              },
            ]}
            onPress={() => undefined}
            accessibilityViewIsModal
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{task ? "Edit Task" : "New Task"}</Text>
              <Pressable
                style={styles.closeBtn}
                onPress={() => { onClose(); resetForm(); }}
                accessibilityRole="button"
                accessibilityLabel="Close task form"
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.formFields}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Task title *"
                placeholderTextColor={colors.mutedForeground}
                value={title}
                onChangeText={setTitle}
                autoFocus={!task}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                accessibilityLabel="Task title, required"
                accessibilityHint="Enter a short, clear task name"
              />

              <TextInput
                style={[styles.input, styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Description (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={2}
                accessibilityLabel="Task description, optional"
              />

              {task && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Status</Text>
                  <Pressable
                    style={[styles.pickerRow, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => setShowStatusPicker(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Select status, currently ${status === "todo" ? "To Do" : status === "in_progress" ? "In Progress" : "Done"}`}
                    accessibilityHint="Opens the task status choices"
                  >
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: status === "todo" ? "#9ca3af" : status === "in_progress" ? "#1d4ed8" : "#16a34a" }} />
                    <Text style={[styles.pickerText, { color: colors.foreground }]}>
                      {status === "todo" ? "To Do" : status === "in_progress" ? "In Progress" : "Done"}
                    </Text>
                    <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
                  </Pressable>
                </>
              )}

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Priority</Text>
              <View style={styles.priorityRow}>
                {PRIORITIES.map((p) => (
                  <Pressable
                    key={p}
                    style={[
                      styles.priorityBtn,
                      {
                        borderColor: priority === p ? priorityColor(p) : colors.border,
                        backgroundColor: priority === p ? priorityColor(p) + "22" : colors.background,
                      },
                    ]}
                    onPress={() => setPriority(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: priority === p }}
                    accessibilityLabel={`${p.charAt(0).toUpperCase() + p.slice(1)} priority`}
                  >
                    <Text style={[styles.priorityText, { color: priority === p ? priorityColor(p) : colors.mutedForeground }]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Project</Text>
              <Pressable
                style={[
                  styles.pickerRow,
                  { backgroundColor: !task || isOwner ? colors.background : colors.muted, borderColor: colors.border },
                ]}
                onPress={() => (!task || isOwner) && setShowProjectPicker(true)}
                disabled={!!task && !isOwner}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!task && !isOwner }}
                accessibilityLabel={`Select project, currently ${projectName}`}
              >
                <Feather name="folder" size={15} color={colors.mutedForeground} />
                <Text style={[styles.pickerText, { color: colors.foreground }]}>{projectName}</Text>
                {!task || isOwner ? <Feather name="chevron-down" size={15} color={colors.mutedForeground} /> : null}
              </Pressable>

              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Due date (YYYY-MM-DD, optional)"
                placeholderTextColor={colors.mutedForeground}
                value={dueDate}
                onChangeText={setDueDate}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                accessibilityLabel="Due date, optional"
                accessibilityHint="Use year, month, and day, for example 2026-08-21"
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Assign to</Text>
              <Pressable
                style={[
                  styles.pickerRow,
                  { backgroundColor: canChangeAssign ? colors.background : colors.muted, borderColor: colors.border },
                ]}
                onPress={() => canChangeAssign && setShowAssignmentPicker(true)}
                disabled={!canChangeAssign}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canChangeAssign }}
                accessibilityLabel={`Select assignee, currently ${assignmentLabel}`}
              >
                <Feather name={assignmentIcon} size={15} color={colors.mutedForeground} />
                <Text style={[styles.pickerText, { color: colors.foreground }]}>{assignmentLabel}</Text>
                {canChangeAssign ? <Feather name="chevron-down" size={15} color={colors.mutedForeground} /> : null}
              </Pressable>

              {!isEntireTeam && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Sharing</Text>
                  <Pressable
                    style={[
                      styles.pickerRow,
                      { backgroundColor: canManageSharing ? colors.background : colors.muted, borderColor: colors.border },
                    ]}
                    onPress={() => canManageSharing && setShowSharePicker(true)}
                    disabled={!canManageSharing}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canManageSharing }}
                    accessibilityLabel={`Manage sharing, currently ${
                      sharedMemberIds.length > 0
                        ? `shared with ${sharedMemberIds.length}`
                        : "private"
                    }`}
                  >
                    <Feather
                      name={sharedMemberIds.length > 0 ? "users" : "lock"}
                      size={15}
                      color={colors.mutedForeground}
                    />
                    <Text style={[styles.pickerText, { color: colors.foreground }]}>
                      {sharedMemberIds.length > 0
                        ? `Shared with ${sharedMemberIds.length}`
                        : !task
                          ? "Private to you"
                          : "Private"}
                    </Text>
                    {canManageSharing ? <Feather name="chevron-right" size={15} color={colors.mutedForeground} /> : null}
                  </Pressable>
                </>
              )}

            </View>

            <View style={styles.formActions}>
              {task && isOwner ? (
                <Pressable
                  style={[styles.deleteBtn, { borderColor: colors.destructive }]}
                  onPress={handleDelete}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Delete Task"
                >
                  <Feather name="trash-2" size={17} color={colors.destructive} />
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => { onClose(); resetForm(); }}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel task changes"
              >
                <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: !title.trim() || isSaving ? 0.5 : 1 }]}
                onPress={submit}
                disabled={!title.trim() || isSaving}
                accessibilityRole="button"
                accessibilityState={{ disabled: !title.trim() || isSaving }}
                accessibilityLabel={task ? "Save task changes" : "Create task"}
              >
                <Text style={styles.submitText}>{isSaving ? "Saving…" : task ? "Save Task" : "Create Task"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </Pressable>

      <StatusPickerModal
        visible={showStatusPicker}
        title="Update Status"
        currentStatus={status}
        options={[
          { value: "todo", label: "To Do", dotColor: "#9ca3af" },
          { value: "in_progress", label: "In Progress", dotColor: "#1d4ed8" },
          { value: "done", label: "Done", dotColor: "#16a34a" },
        ]}
        onClose={() => setShowStatusPicker(false)}
        onSelect={(s) => {
          setStatus(s);
          setShowStatusPicker(false);
        }}
      />

      {/* Assignment picker: Entire team, Unassigned, or an active member */}
      <AssignmentPickerSheet
        visible={showAssignmentPicker}
        assignment={assignment}
        members={activeMembers}
        onClose={() => setShowAssignmentPicker(false)}
        onSelect={(a) => {
          setAssignment(a);
          // If switching to entire team, clear per-member shares (no-op, handled in submit)
          setShowAssignmentPicker(false);
        }}
      />

      <MemberPickerSheet
        visible={showSharePicker}
        selectedIds={sharedMemberIds}
        excludeMemberId={currentMember?.id}
        onClose={() => setShowSharePicker(false)}
        onApply={setSharedMemberIds}
      />

      <ProjectPickerSheet
        visible={showProjectPicker}
        selectedId={projectId}
        onClose={() => setShowProjectPicker(false)}
        onSelect={setProjectId}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// AssignmentPickerSheet — inline component for assignment selection
// ---------------------------------------------------------------------------

interface AssignmentPickerProps {
  visible: boolean;
  assignment: AssignmentMode;
  members: Array<{ id: number; name: string; role: string; isActive: boolean }>;
  onClose: () => void;
  onSelect: (a: AssignmentMode) => void;
}

function AssignmentPickerSheet({ visible, assignment, members, onClose, onSelect }: AssignmentPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (visible) setSearch("");
  }, [visible]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(term) ||
        (m.role ?? "").toLowerCase().includes(term),
    );
  }, [members, search]);

  const isTeam = assignment.kind === "team";
  const isUnassigned = assignment.kind === "unassigned";

  const optionBg = (selected: boolean) =>
    selected ? colors.primary + "11" : colors.background;
  const optionBorder = (selected: boolean) =>
    selected ? colors.primary : colors.border;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={assignStyles.overlay} onPress={onClose}>
        <View
          style={[assignStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={[assignStyles.handle, { backgroundColor: colors.border }]} />

          <View style={assignStyles.header}>
            <Text style={[assignStyles.title, { color: colors.foreground }]}>Assign to</Text>
            <Pressable
              onPress={onClose}
              style={assignStyles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close assignment picker"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[assignStyles.subtitle, { color: colors.mutedForeground }]}>
            Choose who this task is assigned to.
          </Text>

          {/* Fixed options: Entire team + Unassigned */}
          <View style={assignStyles.fixedOptions}>
            <Pressable
              style={[
                assignStyles.option,
                { borderColor: optionBorder(isTeam), backgroundColor: optionBg(isTeam) },
              ]}
              onPress={() => onSelect({ kind: "team" })}
              accessibilityRole="radio"
              accessibilityState={{ selected: isTeam }}
              accessibilityLabel="Entire team"
            >
              <Feather name="globe" size={18} color={isTeam ? colors.primary : colors.mutedForeground} />
              <View style={assignStyles.optionText}>
                <Text style={[assignStyles.optionName, { color: colors.foreground }]}>Entire team</Text>
                <Text style={[assignStyles.optionRole, { color: colors.mutedForeground }]}>
                  Visible to all members
                </Text>
              </View>
              <View
                style={[
                  assignStyles.radio,
                  { borderColor: isTeam ? colors.primary : colors.border, backgroundColor: isTeam ? colors.primary : "transparent" },
                ]}
              >
                {isTeam && <Feather name="check" size={14} color="#fff" />}
              </View>
            </Pressable>

            <Pressable
              style={[
                assignStyles.option,
                { borderColor: optionBorder(isUnassigned), backgroundColor: optionBg(isUnassigned) },
              ]}
              onPress={() => onSelect({ kind: "unassigned" })}
              accessibilityRole="radio"
              accessibilityState={{ selected: isUnassigned }}
              accessibilityLabel="Unassigned"
            >
              <Feather name="user-x" size={18} color={isUnassigned ? colors.primary : colors.mutedForeground} />
              <View style={assignStyles.optionText}>
                <Text style={[assignStyles.optionName, { color: colors.foreground }]}>Unassigned</Text>
                <Text style={[assignStyles.optionRole, { color: colors.mutedForeground }]}>
                  No specific assignee
                </Text>
              </View>
              <View
                style={[
                  assignStyles.radio,
                  { borderColor: isUnassigned ? colors.primary : colors.border, backgroundColor: isUnassigned ? colors.primary : "transparent" },
                ]}
              >
                {isUnassigned && <Feather name="check" size={14} color="#fff" />}
              </View>
            </Pressable>
          </View>

          {/* Search for individual members */}
          <View style={[assignStyles.searchRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search members"
              placeholderTextColor={colors.mutedForeground}
              style={[assignStyles.searchInput, { color: colors.foreground }]}
              accessibilityLabel="Search members"
            />
          </View>

          <ScrollView style={assignStyles.list} contentContainerStyle={assignStyles.listContent}>
            {filtered.map((m) => {
              const selected = assignment.kind === "member" && assignment.memberId === m.id;
              return (
                <Pressable
                  key={m.id}
                  style={[
                    assignStyles.option,
                    { borderColor: optionBorder(selected), backgroundColor: optionBg(selected) },
                  ]}
                  onPress={() => onSelect({ kind: "member", memberId: m.id })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${m.name}, ${m.role || "Member"}`}
                >
                  <Feather name="user" size={18} color={selected ? colors.primary : colors.mutedForeground} />
                  <View style={assignStyles.optionText}>
                    <Text style={[assignStyles.optionName, { color: colors.foreground }]}>{m.name}</Text>
                    <Text style={[assignStyles.optionRole, { color: colors.mutedForeground }]}>{m.role || "Member"}</Text>
                  </View>
                  <View
                    style={[
                      assignStyles.radio,
                      { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" },
                    ]}
                  >
                    {selected && <Feather name="check" size={14} color="#fff" />}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[assignStyles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Pressable
              style={[assignStyles.doneBtn, { backgroundColor: colors.primary }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Confirm assignment selection"
            >
              <Text style={assignStyles.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function priorityColor(p: Priority) {
  if (p === "high") return "#ef4444";
  if (p === "medium") return "#f59e0b";
  return "#22c55e";
}

function normalizePriority(priority: string | null | undefined): Priority {
  const normalized = priority?.trim().toLowerCase();
  return normalized === "low" || normalized === "high" ? normalized : "medium";
}

function normalizeTaskStatus(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase().replaceAll(" ", "_");
  if (normalized === "done" || normalized === "completed") return "done";
  if (normalized === "in_progress" || normalized === "review") return "in_progress";
  return "todo";
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  keyboardScroll: { flex: 1 },
  keyboardContent: { flexGrow: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  formFields: { gap: 12 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 8 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -12 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  priorityRow: { flexDirection: "row", gap: 10 },
  priorityBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
  },
  priorityText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pickerText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  formActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
  },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  submitBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  deleteBtn: {
    width: 52,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: { color: "#ef4444", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

const assignStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    maxHeight: "85%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  subtitle: {
    paddingHorizontal: 20,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    marginBottom: 12,
  },
  fixedOptions: {
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    gap: 12,
  },
  optionText: { flex: 1 },
  optionName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  optionRole: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  list: { flexShrink: 1 },
  listContent: { paddingHorizontal: 20, gap: 10, paddingBottom: 20 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  doneBtn: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
});

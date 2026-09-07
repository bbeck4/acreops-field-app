import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  getListProjectsQueryKey,
  type Project,
  type ProjectInput,
  type ProjectUpdate,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAppAuth } from "@/context/AuthContext";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { MemberPickerSheet } from "./MemberPickerSheet";
import { StatusPickerModal } from "./StatusPickerModal";

interface Props {
  visible: boolean;
  project?: Project | null;
  onClose: () => void;
}

export function ProjectFormSheet({ visible, project, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Planning");
  const [dueDate, setDueDate] = useState("");
  const [sharedMemberIds, setSharedMemberIds] = useState<number[]>([]);

  const [showSharePicker, setShowSharePicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const { mutateAsync: createProject, isPending: isCreating } = useCreateProject();
  const { mutateAsync: updateProject, isPending: isUpdating } = useUpdateProject();
  const { mutateAsync: deleteProject, isPending: isDeleting } = useDeleteProject();
  const isSaving = isCreating || isUpdating || isDeleting;

  React.useEffect(() => {
    if (!visible) return;
    if (project) {
      setName(project.name);
      setDescription(project.description || "");
      setStatus(project.status || "Planning");
      setDueDate(project.dueDate || "");
      setSharedMemberIds(project.sharedMemberIds || []);
      return;
    }
    resetForm();
  }, [visible, project]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setStatus("Planning");
    setDueDate("");
    setSharedMemberIds([]);
  };

  const isOwner = project ? project.ownerId === currentMember?.id : true;
  const canManageSharing = !project || (isOwner && project.visibility === "private");

  const submit = async () => {
    if (!name.trim() || isSaving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (project) {
        const data: ProjectUpdate = {
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          dueDate: dueDate.trim() || undefined,
          ...(canManageSharing ? { sharedMemberIds } : {}),
        };
        await updateProject({ id: project.id, data });
      } else {
        const data: ProjectInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          dueDate: dueDate.trim() || undefined,
          sharedMemberIds,
        };
        await createProject({ data });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
      resetForm();
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch {
      Alert.alert("Error", `Could not ${project ? "update" : "create"} project. Please try again.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleDelete = () => {
    if (!project || !isOwner) return;
    Alert.alert("Delete Project", "Are you sure you want to delete this project?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteProject({ id: project.id });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onClose();
            resetForm();
            queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          } catch {
            Alert.alert("Error", "Could not delete project.");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
        },
      },
    ]);
  };

  if (!visible) return null;

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
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {project ? "Edit Project" : "New Project"}
              </Text>
              <Pressable
                style={styles.closeBtn}
                onPress={() => { onClose(); resetForm(); }}
                accessibilityRole="button"
                accessibilityLabel="Close project form"
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.formFields}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Project name *"
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
                autoFocus={!project}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                accessibilityLabel="Project name, required"
                accessibilityHint="Enter a short, clear project name"
              />

              <TextInput
                style={[styles.input, styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Description (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={2}
                accessibilityLabel="Project description, optional"
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Status</Text>
              <Pressable
                style={[styles.pickerRow, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setShowStatusPicker(true)}
                accessibilityRole="button"
                accessibilityLabel={`Select project status, currently ${status}`}
                accessibilityHint="Opens the project status choices"
              >
                <Feather name="activity" size={15} color={colors.mutedForeground} />
                <Text style={[styles.pickerText, { color: colors.foreground }]}>{status}</Text>
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
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
                accessibilityLabel="Project due date, optional"
                accessibilityHint="Use year, month, and day, for example 2026-08-21"
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Sharing</Text>
              {canManageSharing ? (
                <Pressable
                  style={[styles.pickerRow, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowSharePicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage sharing, currently ${
                    sharedMemberIds.length > 0 ? `shared with ${sharedMemberIds.length}` : "private to you"
                  }`}
                >
                  <Feather name="users" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.pickerText, { color: colors.foreground }]}>
                    {sharedMemberIds.length > 0 ? `Shared with ${sharedMemberIds.length}` : "Private to you"}
                  </Text>
                  <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
                </Pressable>
              ) : (
                <View style={[styles.pickerRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Feather
                    name={project?.visibility === "organization" ? "globe" : "users"}
                    size={15}
                    color={colors.mutedForeground}
                  />
                  <Text style={[styles.pickerText, { color: colors.foreground }]}>
                    {project?.visibility === "organization"
                      ? "Entire team"
                      : sharedMemberIds.length > 0
                        ? `Shared with ${sharedMemberIds.length}`
                        : "Private"}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.formActions}>
              {project && isOwner ? (
                <Pressable
                  style={[styles.deleteBtn, { borderColor: colors.destructive }]}
                  onPress={handleDelete}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Delete Project"
                >
                  <Feather name="trash-2" size={17} color={colors.destructive} />
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => { onClose(); resetForm(); }}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel project changes"
              >
                <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: !name.trim() || isSaving ? 0.5 : 1 }]}
                onPress={submit}
                disabled={!name.trim() || isSaving}
                accessibilityRole="button"
                accessibilityState={{ disabled: !name.trim() || isSaving }}
                accessibilityLabel={project ? "Save project changes" : "Create project"}
              >
                <Text style={styles.submitText}>
                  {isSaving ? "Saving…" : project ? "Save Project" : "Create Project"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAwareScrollViewCompat>
      </Pressable>

      <MemberPickerSheet
        visible={showSharePicker}
        selectedIds={sharedMemberIds}
        excludeMemberId={currentMember?.id}
        onClose={() => setShowSharePicker(false)}
        onApply={setSharedMemberIds}
      />
      <StatusPickerModal
        visible={showStatusPicker}
        title="Project Status"
        itemTitle={name}
        currentStatus={status}
        options={[
          { value: "Planning", label: "Planning", dotColor: colors.mutedForeground },
          { value: "In Progress", label: "In Progress", dotColor: colors.primary },
          { value: "On Hold", label: "On Hold", dotColor: colors.warning },
          { value: "Completed", label: "Completed", dotColor: colors.primary },
        ]}
        onClose={() => setShowStatusPicker(false)}
        onSelect={(nextStatus) => {
          setStatus(nextStatus);
          setShowStatusPicker(false);
        }}
      />
    </>
  );
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
  deleteBtn: {
    width: 52,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});

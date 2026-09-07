import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useArchiveProspectVoiceNote,
  useConvertProspect,
  useCreateProspectActivity,
  useCreateProspectCrop,
  useCreateProspectProduct,
  useCreateProspectTask,
  useUpdateProspectTask,
  useUpdateProspectCrop,
  useUpdateProspectProduct,
  useDeleteProspectCrop,
  useDeleteProspectProduct,
  useDeleteProspectVoiceNote,
  useGetProspect,
  useListMembers,
  useListProducts,
  useListProspectActivities,
  useListProspectCrops,
  useListProspectProducts,
  useListProspectTasks,
  type ProspectTaskInput,
} from "@workspace/api-client-react";
import {
  deriveVisibilityAndAssignee,
  type AssignmentMode,
} from "@/lib/taskAssignment";

import { ActivityItem } from "@/components/ActivityItem";
import { isAudioBackedActivity } from "@/lib/activityAudio";
import { MediaGallery } from "@/components/MediaGallery";
import { EditProspectModal } from "@/components/EditProspectModal";
import { EmptyState } from "@/components/EmptyState";
import { ForwardVoiceNoteModal } from "@/components/ForwardVoiceNoteModal";
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { canNavigate, openNavigation } from "@/lib/navigation";
import { usePermissions } from "@/lib/permissions";

type TabName = "overview" | "crops" | "products" | "activity" | "tasks" | "media";
const TABS: { key: TabName; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "crops", label: "Crops" },
  { key: "products", label: "Products" },
  { key: "activity", label: "Activity" },
  { key: "tasks", label: "Tasks" },
  { key: "media", label: "Media" },
];
const ACTIVITY_TYPES = ["note", "call", "visit", "email"] as const;
const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;
const TASK_STATUSES = ["To Do", "In Progress", "Review", "Done"] as const;

function isTaskDone(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "done";
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  new: { bg: "#dbeafe", fg: "#1d4ed8" },
  contacted: { bg: "#fef3c7", fg: "#b45309" },
  qualified: { bg: "#dcfce7", fg: "#15803d" },
  nurturing: { bg: "#f3e8ff", fg: "#7e22ce" },
  lost: { bg: "#fee2e2", fg: "#b91c1c" },
  converted: { bg: "#d1fae5", fg: "#047857" },
};

function formatDate(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

export default function ProspectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const prospectId = parseInt(id ?? "0", 10);

  const [activeTab, setActiveTab] = useState<TabName>("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>("note");
  const [actSubject, setActSubject] = useState("");
  const [actNotes, setActNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  const [cropName, setCropName] = useState("");
  const [cropAcres, setCropAcres] = useState("");
  const [cropField, setCropField] = useState("");
  const [savingCrop, setSavingCrop] = useState(false);
  const [editingCropId, setEditingCropId] = useState<number | null>(null);

  const [productName, setProductName] = useState("");
  const [productQty, setProductQty] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<(typeof TASK_PRIORITIES)[number]>("Medium");
  const [taskDue, setTaskDue] = useState("");
  const [taskAssignment, setTaskAssignment] = useState<AssignmentMode>({ kind: "unassigned" });
  const [savingTask, setSavingTask] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);

  const { data: prospect, isLoading, refetch } = useGetProspect(prospectId);
  const { data: activities, refetch: refetchActivities } =
    useListProspectActivities(prospectId);
  const { data: crops, refetch: refetchCrops } = useListProspectCrops(prospectId);
  const { data: products, refetch: refetchProducts } = useListProspectProducts(prospectId);
  const { data: tasks, refetch: refetchTasks } = useListProspectTasks(prospectId);
  const { data: catalogProducts } = useListProducts();
  const { mutateAsync: createActivityMutation } = useCreateProspectActivity();
  const { mutateAsync: convertMutation } = useConvertProspect();
  const { mutateAsync: createCropMutation } = useCreateProspectCrop();
  const { mutateAsync: updateCropMutation } = useUpdateProspectCrop();
  const { mutateAsync: deleteCropMutation } = useDeleteProspectCrop();
  const { mutateAsync: createProductMutation } = useCreateProspectProduct();
  const { mutateAsync: updateProductMutation } = useUpdateProspectProduct();
  const { mutateAsync: deleteProductMutation } = useDeleteProspectProduct();
  const { mutateAsync: createTaskMutation } = useCreateProspectTask();
  const { mutateAsync: updateTaskMutation } = useUpdateProspectTask();
  const { data: members } = useListMembers();
  const activeMembers = React.useMemo(() => (members ?? []).filter((m) => m.isActive), [members]);
  const { currentMember } = useAppAuth();
  const isManager = currentMember?.role === "manager" || currentMember?.role === "admin";
  const { canDo } = usePermissions();
  const canEdit = canDo("prospects.edit");
  const { mutateAsync: archiveVoiceMutation, isPending: isArchivingVoice } =
    useArchiveProspectVoiceNote();
  const { mutateAsync: deleteVoiceMutation, isPending: isDeletingVoice } =
    useDeleteProspectVoiceNote();
  const [forwardingVoiceId, setForwardingVoiceId] = useState<number | null>(null);

  const handleArchiveVoice = (activityId: number) => {
    Alert.alert("Archive voice note?", "It will be hidden from the timeline but kept in the archive.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        onPress: async () => {
          try {
            await archiveVoiceMutation({ activityId });
            await refetchActivities();
          } catch {
            Alert.alert("Failed", "Could not archive voice note.");
          }
        },
      },
    ]);
  };

  const handleDeleteVoice = (activityId: number) => {
    Alert.alert("Delete voice note?", "The recording and transcript will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteVoiceMutation({ activityId });
            await refetchActivities();
          } catch {
            Alert.alert("Failed", "Could not delete voice note.");
          }
        },
      },
    ]);
  };

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const primaryPhone = prospect?.phone || null;
  const primaryEmail = prospect?.email || null;
  const isConverted = prospect?.status?.toLowerCase() === "converted";

  const runConvert = async () => {
    setIsConverting(true);
    try {
      const res = await convertMutation({ id: prospectId });
      await refetch();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/customer/${res.customerId}`);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Conversion failed", "Could not convert this prospect. Please try again.");
    } finally {
      setIsConverting(false);
    }
  };

  const confirmConvert = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Convert to customer?",
      "This will copy contact info, create fields from crops, copy activities, and re-point open tasks.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Convert", style: "default", onPress: runConvert },
      ],
    );
  };

  const submitActivity = async () => {
    if (!actSubject.trim()) return;
    setIsSaving(true);
    try {
      await createActivityMutation({
        id: prospectId,
        data: {
          type: actType,
          subject: actSubject.trim(),
          notes: actNotes.trim() || undefined,
        },
      });
      refetchActivities();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
      setActSubject("");
      setActNotes("");
      setActType("note");
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const resetCropForm = () => {
    setCropName("");
    setCropAcres("");
    setCropField("");
    setEditingCropId(null);
  };

  const startEditCrop = (crop: { id: number; cropName: string; acres?: number | null; fieldName?: string | null }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingCropId(crop.id);
    setCropName(crop.cropName);
    setCropAcres(crop.acres != null ? String(crop.acres) : "");
    setCropField(crop.fieldName ?? "");
    setActiveTab("crops");
  };

  const submitCrop = async () => {
    if (!cropName.trim() || savingCrop) return;
    setSavingCrop(true);
    try {
      const data = {
        cropName: cropName.trim(),
        acres: cropAcres.trim() ? Number(cropAcres) : undefined,
        fieldName: cropField.trim() || undefined,
      };
      if (editingCropId != null) {
        await updateCropMutation({ id: editingCropId, data });
      } else {
        await createCropMutation({ id: prospectId, data });
      }
      refetchCrops();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetCropForm();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingCrop(false);
    }
  };

  const removeCrop = async (cropId: number) => {
    try {
      await deleteCropMutation({ id: cropId });
      refetchCrops();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const resolvedProductName = selectedProduct ? selectedProduct.name : productName.trim();

  const resetProductForm = () => {
    setProductName("");
    setProductQty("");
    setSelectedProduct(null);
    setEditingProductId(null);
  };

  const startEditProduct = (item: {
    id: number;
    productId?: number | null;
    productName: string;
    sku?: string | null;
    quantity?: number | null;
  }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingProductId(item.id);
    setProductQty(item.quantity != null ? String(item.quantity) : "");
    if (item.productId != null) {
      setSelectedProduct({ id: item.productId, name: item.productName, sku: item.sku ?? null });
      setProductName("");
    } else {
      setSelectedProduct(null);
      setProductName(item.productName);
    }
    setActiveTab("products");
  };

  const submitProduct = async () => {
    if (!resolvedProductName || savingProduct) return;
    setSavingProduct(true);
    try {
      const match = catalogProducts?.find(
        (p) => p.name.toLowerCase() === productName.trim().toLowerCase(),
      );
      const data = {
        productId: selectedProduct ? selectedProduct.id : match?.id,
        productName: resolvedProductName,
        quantity: productQty.trim() ? Number(productQty) : undefined,
      };
      if (editingProductId != null) {
        await updateProductMutation({ id: editingProductId, data });
      } else {
        await createProductMutation({ id: prospectId, data });
      }
      refetchProducts();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      resetProductForm();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingProduct(false);
    }
  };

  const removeProduct = async (productRowId: number) => {
    try {
      await deleteProductMutation({ id: productRowId });
      refetchProducts();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const submitTask = async () => {
    if (!taskTitle.trim() || savingTask) return;
    setSavingTask(true);
    try {
      const { visibility, assigneeId } = deriveVisibilityAndAssignee(taskAssignment);
      const data: ProspectTaskInput = {
        title: taskTitle.trim(),
        priority: taskPriority,
        dueDate: taskDue.trim() || undefined,
        visibility,
        assigneeId: assigneeId ?? undefined,
      };
      await createTaskMutation({ id: prospectId, data });
      refetchTasks();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTaskTitle("");
      setTaskPriority("Medium");
      setTaskDue("");
      setTaskAssignment({ kind: "unassigned" });
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingTask(false);
    }
  };

  const changeTaskStatus = async (taskId: number, status: string) => {
    setUpdatingTaskId(taskId);
    try {
      await updateTaskMutation({ id: prospectId, taskId, data: { status } });
      await refetchTasks();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Failed", "Could not update task status.");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const toggleTaskDone = (taskId: number, currentStatus: string | null | undefined) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    changeTaskStatus(taskId, isTaskDone(currentStatus) ? "To Do" : "Done");
  };

  const pickTaskStatus = (taskId: number, currentStatus: string | null | undefined) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Set status", undefined, [
      ...TASK_STATUSES.map((s) => ({
        text: s === (currentStatus ?? "") ? `${s} ✓` : s,
        onPress: () => {
          if (s !== currentStatus) changeTaskStatus(taskId, s);
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!prospect) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: topPadding }]}>
        <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
        <Text style={[styles.offlineMsg, { color: colors.foreground }]}>
          Prospect not found.
        </Text>
        <Pressable
          style={[styles.backBtnLarge, { borderColor: colors.border }]}
          onPress={() => router.back()}
        >
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[prospect.status?.toLowerCase()] ?? STATUS_COLORS.new;
  const addressLine = [prospect.address, prospect.city, prospect.state, prospect.zip]
    .filter(Boolean)
    .join(", ");
  const canNavigateToProspect = canNavigate({
    lat: prospect.lat,
    lng: prospect.lng,
    address: addressLine || null,
  });
  const dueDate = formatDate(prospect.nextStepDueDate);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: topPadding }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.topTitle, { color: colors.foreground }]} numberOfLines={1}>
            {prospect.businessName}
          </Text>
          {prospect.contactName ? (
            <Text style={[styles.topSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {prospect.contactName}
            </Text>
          ) : null}
        </View>
        <View style={styles.topActions}>
          {canEdit && (
          <Pressable
            style={[styles.iconBtn, { backgroundColor: colors.accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowEdit(true);
            }}
            testID="edit-prospect-btn"
          >
            <Feather name="edit-2" size={16} color={colors.primary} />
          </Pressable>
          )}
          <View style={[styles.statusPill, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.statusPillText, { color: statusColor.fg }]}>
              {prospect.status}
            </Text>
          </View>
        </View>
      </View>

      {/* Intake approval status (pending / rejected submissions) */}
      <IntakeBanner prospect={prospect} colors={colors} />

      {/* Quick actions */}
      <View style={[styles.quickActions, { borderBottomColor: colors.border }]}>
        <Pressable
          style={[styles.quickBtn, { opacity: primaryPhone ? 1 : 0.4 }]}
          disabled={!primaryPhone}
          onPress={() => primaryPhone && Linking.openURL(`tel:${primaryPhone}`)}
        >
          <Feather name="phone" size={18} color={colors.primary} />
          <Text style={[styles.quickBtnText, { color: colors.foreground }]}>Call</Text>
        </Pressable>
        <Pressable
          style={[styles.quickBtn, { opacity: primaryEmail ? 1 : 0.4 }]}
          disabled={!primaryEmail}
          onPress={() => primaryEmail && Linking.openURL(`mailto:${primaryEmail}`)}
        >
          <Feather name="mail" size={18} color={colors.primary} />
          <Text style={[styles.quickBtnText, { color: colors.foreground }]}>Email</Text>
        </Pressable>
        <Pressable
          style={[styles.quickBtn, { opacity: canNavigateToProspect ? 1 : 0.4 }]}
          disabled={!canNavigateToProspect}
          onPress={() => {
            Haptics.selectionAsync();
            void openNavigation({
              lat: prospect.lat,
              lng: prospect.lng,
              address: addressLine || null,
              label: prospect.businessName,
            });
          }}
          testID="btn-navigate-prospect"
        >
          <Feather name="navigation" size={18} color={colors.primary} />
          <Text style={[styles.quickBtnText, { color: colors.foreground }]}>Navigate</Text>
        </Pressable>
        {canEdit && (
        <Pressable
          style={styles.quickBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setActiveTab("activity");
            setShowVoice(true);
          }}
        >
          <Feather name="mic" size={18} color="#ef4444" />
          <Text style={[styles.quickBtnText, { color: colors.foreground }]}>Voice</Text>
        </Pressable>
        )}
      </View>

      {/* Convert / linked customer */}
      {isConverted ? (
        prospect.convertedCustomerId ? (
          <Pressable
            style={[styles.convertBanner, { backgroundColor: colors.accent, borderBottomColor: colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(`/customer/${prospect.convertedCustomerId}` as never);
            }}
            testID="view-customer-btn"
          >
            <Feather name="check-circle" size={16} color="#047857" />
            <Text style={[styles.convertBannerText, { color: colors.foreground }]}>
              Converted — view customer
            </Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null
      ) : canEdit ? (
        <Pressable
          style={[
            styles.convertBtn,
            { backgroundColor: colors.primary, opacity: isConverting ? 0.6 : 1 },
          ]}
          onPress={confirmConvert}
          disabled={isConverting}
          testID="convert-prospect-btn"
        >
          {isConverting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="user-plus" size={16} color="#fff" />
              <Text style={styles.convertBtnText}>Convert to customer</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {/* Tabs */}
      <View style={[styles.tabBarWrap, { borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              style={[
                styles.tab,
                activeTab === t.key
                  ? { borderBottomColor: colors.primary }
                  : { borderBottomColor: "transparent" },
              ]}
              onPress={() => setActiveTab(t.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === t.key ? colors.primary : colors.mutedForeground },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "overview" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
            <SectionLabel colors={colors}>Prospect</SectionLabel>
            {prospect.contactName ? (
              <InfoRow label="Contact" colors={colors}>
                {prospect.contactName}
                {prospect.title ? `  ·  ${prospect.title}` : ""}
              </InfoRow>
            ) : null}
            {prospect.email ? <InfoRow label="Email" colors={colors}>{prospect.email}</InfoRow> : null}
            {prospect.phone ? <InfoRow label="Phone" colors={colors}>{prospect.phone}</InfoRow> : null}
            <InfoRow label="Address" colors={colors}>{addressLine || "—"}</InfoRow>
            {prospect.county ? <InfoRow label="County" colors={colors}>{prospect.county}</InfoRow> : null}

            <SectionLabel colors={colors}>Sales</SectionLabel>
            {prospect.rating ? <InfoRow label="Rating" colors={colors}>{prospect.rating}</InfoRow> : null}
            {prospect.leadSource ? <InfoRow label="Lead source" colors={colors}>{prospect.leadSource}</InfoRow> : null}
            {prospect.estimatedValue != null ? (
              <InfoRow label="Est. value" colors={colors}>${prospect.estimatedValue.toLocaleString()}</InfoRow>
            ) : null}
            {prospect.nextStep ? (
              <InfoRow label="Next step" colors={colors}>
                {prospect.nextStep}
                {dueDate ? `  ·  due ${dueDate}` : ""}
              </InfoRow>
            ) : null}
            {prospect.ownerName ? <InfoRow label="Owner" colors={colors}>{prospect.ownerName}</InfoRow> : null}
            {prospect.territory ? <InfoRow label="Territory" colors={colors}>{prospect.territory}</InfoRow> : null}
            {prospect.status === "lost" && prospect.lostReason ? (
              <InfoRow label="Lost reason" colors={colors}>{prospect.lostReason}</InfoRow>
            ) : null}
            {prospect.status === "lost" && prospect.lostByName ? (
              <InfoRow label="Rejected by" colors={colors}>{prospect.lostByName}</InfoRow>
            ) : null}
            {prospect.status === "lost" && formatDate(prospect.lostAt) ? (
              <InfoRow label="Rejected on" colors={colors}>{formatDate(prospect.lostAt)}</InfoRow>
            ) : null}

            <SectionLabel colors={colors}>Farm operation</SectionLabel>
            {prospect.primaryCrop ? <InfoRow label="Primary crop" colors={colors}>{prospect.primaryCrop}</InfoRow> : null}
            {prospect.totalAcres != null ? (
              <InfoRow label="Total acres" colors={colors}>{prospect.totalAcres.toLocaleString()}</InfoRow>
            ) : null}
            {prospect.irrigationType ? <InfoRow label="Irrigation" colors={colors}>{prospect.irrigationType}</InfoRow> : null}
            {prospect.tillagePractice ? <InfoRow label="Tillage" colors={colors}>{prospect.tillagePractice}</InfoRow> : null}
            {prospect.livestock ? <InfoRow label="Livestock" colors={colors}>{prospect.livestock}</InfoRow> : null}
            {prospect.equipmentNotes ? <InfoRow label="Equipment" colors={colors}>{prospect.equipmentNotes}</InfoRow> : null}

            <SectionLabel colors={colors}>Sales context</SectionLabel>
            {prospect.decisionMakerRole ? <InfoRow label="Decision role" colors={colors}>{prospect.decisionMakerRole}</InfoRow> : null}
            {prospect.currentSupplier ? <InfoRow label="Supplier" colors={colors}>{prospect.currentSupplier}</InfoRow> : null}
            {prospect.contractRenewalMonth != null ? (
              <InfoRow label="Renewal month" colors={colors}>{prospect.contractRenewalMonth}</InfoRow>
            ) : null}
            {prospect.needsAndWants ? <InfoRow label="Needs & wants" colors={colors}>{prospect.needsAndWants}</InfoRow> : null}
            {prospect.notes ? <InfoRow label="Notes" colors={colors}>{prospect.notes}</InfoRow> : null}
          </View>
        ) : null}

        {activeTab === "crops" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {canEdit && (
            <View style={[styles.actForm, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 0 }]}>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Crop *"
                placeholderTextColor={colors.mutedForeground}
                value={cropName}
                onChangeText={setCropName}
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextInput
                  style={[styles.formInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Acres"
                  placeholderTextColor={colors.mutedForeground}
                  value={cropAcres}
                  onChangeText={setCropAcres}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.formInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Field (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={cropField}
                  onChangeText={setCropField}
                />
              </View>
              <View style={styles.formActions}>
                {editingCropId != null ? (
                  <Pressable
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      resetCropForm();
                    }}
                    disabled={savingCrop}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: cropName.trim() && !savingCrop ? 1 : 0.5, flexDirection: "row", gap: 6 }]}
                  onPress={submitCrop}
                  disabled={!cropName.trim() || savingCrop}
                >
                  {savingCrop ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name={editingCropId != null ? "check" : "plus"} size={16} color="#fff" />
                      <Text style={styles.saveBtnText}>{editingCropId != null ? "Save changes" : "Add crop"}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
            )}

            {!crops || crops.length === 0 ? (
              <EmptyState icon="feather" title="No crops yet" subtitle="Add crops and acres recorded in the field." />
            ) : (
              crops.map((c) => (
                <View
                  key={c.id}
                  style={[
                    styles.rowCard,
                    { backgroundColor: colors.card, borderColor: editingCropId === c.id ? colors.primary : colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{c.cropName}</Text>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                      {c.acres != null ? `${c.acres.toLocaleString()} ac` : "— ac"}
                      {c.fieldName ? `  ·  ${c.fieldName}` : ""}
                    </Text>
                  </View>
                  {canEdit && (
                    <>
                      <Pressable hitSlop={8} onPress={() => startEditCrop(c)} style={styles.rowAction}>
                        <Feather name="edit-2" size={17} color={colors.mutedForeground} />
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => removeCrop(c.id)} style={styles.rowAction}>
                        <Feather name="trash-2" size={18} color={colors.mutedForeground} />
                      </Pressable>
                    </>
                  )}
                </View>
              ))
            )}
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              When you convert this prospect, each crop becomes a field on the customer.
            </Text>
          </View>
        ) : null}

        {activeTab === "products" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {canEdit && (
            <View style={[styles.actForm, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 0 }]}>
              {selectedProduct ? (
                <View
                  style={[
                    styles.selectedProduct,
                    { backgroundColor: colors.accent, borderColor: colors.border },
                  ]}
                >
                  <Feather name="package" size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectedProductName, { color: colors.foreground }]} numberOfLines={1}>
                      {selectedProduct.name}
                    </Text>
                    {selectedProduct.sku ? (
                      <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {selectedProduct.sku}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable hitSlop={8} onPress={() => setSelectedProduct(null)}>
                    <Feather name="x" size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ) : (
                <>
                  <Pressable
                    style={[styles.catalogBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowProductPicker(true);
                    }}
                    testID="pick-catalog-product-btn"
                  >
                    <Feather name="search" size={16} color={colors.primary} />
                    <Text style={[styles.catalogBtnText, { color: colors.foreground }]}>
                      Select from catalog
                    </Text>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </Pressable>
                  <Text style={[styles.orLabel, { color: colors.mutedForeground }]}>
                    or enter a custom product
                  </Text>
                  <TextInput
                    style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="Custom product name"
                    placeholderTextColor={colors.mutedForeground}
                    value={productName}
                    onChangeText={setProductName}
                  />
                </>
              )}
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Quantity (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={productQty}
                onChangeText={setProductQty}
                keyboardType="numeric"
              />
              <View style={styles.formActions}>
                {editingProductId != null ? (
                  <Pressable
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      resetProductForm();
                    }}
                    disabled={savingProduct}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: resolvedProductName && !savingProduct ? 1 : 0.5, flexDirection: "row", gap: 6 }]}
                  onPress={submitProduct}
                  disabled={!resolvedProductName || savingProduct}
                >
                  {savingProduct ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name={editingProductId != null ? "check" : "plus"} size={16} color="#fff" />
                      <Text style={styles.saveBtnText}>{editingProductId != null ? "Save changes" : "Add product"}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
            )}

            {!products || products.length === 0 ? (
              <EmptyState icon="package" title="No interested products yet" subtitle="Track which products this lead wants." />
            ) : (
              products.map((p) => {
                const isCatalog = p.productId != null;
                return (
                  <View
                    key={p.id}
                    style={[
                      styles.rowCard,
                      { backgroundColor: colors.card, borderColor: editingProductId === p.id ? colors.primary : colors.border },
                    ]}
                  >
                    <Feather
                      name={isCatalog ? "package" : "edit-3"}
                      size={18}
                      color={isCatalog ? colors.primary : colors.mutedForeground}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.productTitleRow}>
                        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
                          {p.productName}
                        </Text>
                        {isCatalog ? (
                          <View style={[styles.catalogBadge, { backgroundColor: colors.accent }]}>
                            <Text style={[styles.catalogBadgeText, { color: colors.primary }]}>Catalog</Text>
                          </View>
                        ) : (
                          <View style={[styles.customBadge, { borderColor: colors.border }]}>
                            <Text style={[styles.customBadgeText, { color: colors.mutedForeground }]}>Custom</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                        {p.sku ? `${p.sku}  ·  ` : ""}
                        {p.quantity != null ? `Qty ${p.quantity.toLocaleString()}` : "Qty —"}
                      </Text>
                    </View>
                    {canEdit && (
                      <>
                        <Pressable hitSlop={8} onPress={() => startEditProduct(p)} style={styles.rowAction}>
                          <Feather name="edit-2" size={17} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable hitSlop={8} onPress={() => removeProduct(p.id)} style={styles.rowAction}>
                          <Feather name="trash-2" size={18} color={colors.mutedForeground} />
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {activeTab === "activity" ? (
          <View>
            {canEdit && (
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginVertical: 12 }}>
              <Pressable
                style={[styles.logBtn, { backgroundColor: colors.primary, flex: 1 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowForm(true);
                }}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Log Activity</Text>
              </Pressable>
              <Pressable
                style={[styles.logBtn, { backgroundColor: "#ef4444", flex: 1 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowVoice(true);
                }}
              >
                <Feather name="mic" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Voice</Text>
              </Pressable>
            </View>
            )}

            {showForm ? (
              <View style={[styles.actForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.typeRow}>
                  {ACTIVITY_TYPES.map((t) => (
                    <Pressable
                      key={t}
                      style={[
                        styles.typeBtn,
                        {
                          borderColor: actType === t ? colors.primary : colors.border,
                          backgroundColor: actType === t ? colors.accent : "transparent",
                        },
                      ]}
                      onPress={() => setActType(t)}
                    >
                      <Text
                        style={[
                          styles.typeBtnText,
                          { color: actType === t ? colors.primary : colors.mutedForeground },
                        ]}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={[
                    styles.formInput,
                    { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                  ]}
                  placeholder="Subject *"
                  placeholderTextColor={colors.mutedForeground}
                  value={actSubject}
                  onChangeText={setActSubject}
                />
                <TextInput
                  style={[
                    styles.formInput,
                    styles.formTextarea,
                    { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                  ]}
                  placeholder="Notes (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={actNotes}
                  onChangeText={setActNotes}
                  multiline
                  numberOfLines={3}
                />
                <View style={styles.formActions}>
                  <Pressable
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                    onPress={() => {
                      setShowForm(false);
                      setActSubject("");
                      setActNotes("");
                    }}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: actSubject.trim() && !isSaving ? 1 : 0.5 }]}
                    onPress={submitActivity}
                    disabled={!actSubject.trim() || isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnText}>Save</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={{ paddingTop: 8 }}>
              {!activities || activities.length === 0 ? (
                <EmptyState
                  icon="message-square"
                  title="No activity yet"
                  subtitle="Log a call, visit, or voice note to start the timeline."
                />
              ) : (
                activities.map((a, i) => {
                  const isVoice = isAudioBackedActivity(a) || a.type === "voice_note";
                  return (
                    <ActivityItem
                      key={a.id}
                      type={a.type}
                      subject={a.subject}
                      notes={a.notes}
                      memberName={a.memberName}
                      createdAt={a.occurredAt ?? a.createdAt}
                      isLast={i === activities.length - 1}
                      activityId={a.id}
                      audioPath={a.audioPath ?? null}
                      audioContext="prospect"
                      onArchive={isVoice ? () => handleArchiveVoice(a.id) : undefined}
                      onDelete={isVoice ? () => handleDeleteVoice(a.id) : undefined}
                      onForward={isVoice ? () => setForwardingVoiceId(a.id) : undefined}
                      busy={isVoice && (isArchivingVoice || isDeletingVoice)}
                    />
                  );
                })
              )}
            </View>
          </View>
        ) : null}

        {activeTab === "tasks" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            {canEdit && (
            <View style={[styles.actForm, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 0 }]}>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Task title *"
                placeholderTextColor={colors.mutedForeground}
                value={taskTitle}
                onChangeText={setTaskTitle}
              />
              <View style={styles.typeRow}>
                {TASK_PRIORITIES.map((p) => (
                  <Pressable
                    key={p}
                    style={[
                      styles.typeBtn,
                      {
                        borderColor: taskPriority === p ? colors.primary : colors.border,
                        backgroundColor: taskPriority === p ? colors.accent : "transparent",
                      },
                    ]}
                    onPress={() => setTaskPriority(p)}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        { color: taskPriority === p ? colors.primary : colors.mutedForeground },
                      ]}
                    >
                      {p}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.formInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Due date (YYYY-MM-DD, optional)"
                placeholderTextColor={colors.mutedForeground}
                value={taskDue}
                onChangeText={setTaskDue}
              />
              <Text style={[styles.assigneeLabel, { color: colors.mutedForeground }]}>Assign to</Text>
              <View style={styles.typeRow}>
                {/* Entire team */}
                {(["team", "unassigned"] as const).map((kind) => {
                  const selected = taskAssignment.kind === kind;
                  const label = kind === "team" ? "Entire team" : "Unassigned";
                  return (
                    <Pressable
                      key={kind}
                      style={[
                        styles.typeBtn,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.accent : "transparent",
                        },
                      ]}
                      onPress={() => setTaskAssignment({ kind })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={label}
                    >
                      <Text
                        style={[
                          styles.typeBtnText,
                          { color: selected ? colors.primary : colors.mutedForeground },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
                {/* Active individual members */}
                {activeMembers.map((m) => {
                  const selected = taskAssignment.kind === "member" && taskAssignment.memberId === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      style={[
                        styles.typeBtn,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.accent : "transparent",
                        },
                      ]}
                      onPress={() => setTaskAssignment({ kind: "member", memberId: m.id })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={m.name}
                    >
                      <Text
                        style={[
                          styles.typeBtnText,
                          { color: selected ? colors.primary : colors.mutedForeground },
                        ]}
                      >
                        {m.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.formActions}>
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: taskTitle.trim() && !savingTask ? 1 : 0.5, flexDirection: "row", gap: 6 }]}
                  onPress={submitTask}
                  disabled={!taskTitle.trim() || savingTask}
                >
                  {savingTask ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="plus" size={16} color="#fff" />
                      <Text style={styles.saveBtnText}>Add task</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
            )}

            {!tasks || tasks.length === 0 ? (
              <EmptyState icon="check-square" title="No tasks yet" subtitle="Add a follow-up task for this prospect." />
            ) : (
              tasks.map((t) => {
                const done = isTaskDone(t.status);
                const busy = updatingTaskId === t.id;
                return (
                  <View key={t.id} style={[styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Pressable
                      onPress={canEdit ? () => toggleTaskDone(t.id, t.status) : undefined}
                      disabled={busy || !canEdit}
                      hitSlop={8}
                      style={styles.taskCheck}
                      testID={`task-toggle-${t.id}`}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather
                          name={done ? "check-circle" : "circle"}
                          size={22}
                          color={done ? "#16a34a" : colors.mutedForeground}
                        />
                      )}
                    </Pressable>
                    <Pressable
                      style={{ flex: 1 }}
                      onPress={canEdit ? () => pickTaskStatus(t.id, t.status) : undefined}
                      disabled={busy || !canEdit}
                      testID={`task-status-${t.id}`}
                    >
                      <Text
                        style={[
                          styles.rowTitle,
                          {
                            color: colors.foreground,
                            textDecorationLine: done ? "line-through" : "none",
                            opacity: done ? 0.6 : 1,
                          },
                        ]}
                      >
                        {t.title}
                      </Text>
                      <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                        {t.status}
                        {t.priority ? `  ·  ${t.priority}` : ""}
                        {t.visibility === "organization"
                          ? "  ·  Entire team"
                          : t.assigneeName
                            ? `  ·  ${t.assigneeName}`
                            : ""}
                        {formatDate(t.dueDate) ? `  ·  due ${formatDate(t.dueDate)}` : ""}
                      </Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {activeTab === "media" ? (
          <MediaGallery context={{ prospectId }} canDelete={isManager} />
        ) : null}
      </ScrollView>

      <VoiceNoteRecorder
        entityType="prospect"
        entityId={prospectId}
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        onSaved={() => {
          refetchActivities();
          setActiveTab("activity");
        }}
      />

      <EditProspectModal
        prospect={prospect}
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={() => refetch()}
      />

      <ForwardVoiceNoteModal
        visible={forwardingVoiceId !== null}
        voiceNoteId={forwardingVoiceId}
        currentMemberId={currentMember?.id}
        context="prospect"
        onClose={() => setForwardingVoiceId(null)}
        onSuccess={(count) => {
          Alert.alert(
            "Forwarded",
            `Voice note sent to ${count} teammate${count === 1 ? "" : "s"}.`,
          );
        }}
      />

      <ProductPicker
        visible={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        onSelect={(product) => {
          setSelectedProduct(product);
          setProductName("");
          setShowProductPicker(false);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      />
    </View>
  );
}

type IntakeProspect = {
  intakeState?: string | null;
  rejectionReason?: string | null;
  reviewedByName?: string | null;
  suggestedTerritoryName?: string | null;
  suggestedRepName?: string | null;
};

// Surfaces the intake-approval state for prospects submitted from the field.
// Approved prospects are the normal/formal case, so no banner is shown for them.
function IntakeBanner({
  prospect,
  colors,
}: {
  prospect: IntakeProspect;
  colors: ReturnType<typeof useColors>;
}) {
  const state = (prospect.intakeState ?? "").toLowerCase();
  if (state !== "pending" && state !== "rejected") return null;

  const isRejected = state === "rejected";
  const accent = isRejected ? "#b91c1c" : "#b45309";
  const bg = isRejected ? "#fee2e2" : "#fef3c7";
  const icon = isRejected ? "x-circle" : "clock";
  const title = isRejected ? "Not approved" : "Pending approval";

  const lines: string[] = [];
  if (isRejected) {
    lines.push(prospect.rejectionReason ? `Reason: ${prospect.rejectionReason}` : "No reason was given.");
    if (prospect.reviewedByName) lines.push(`Reviewed by ${prospect.reviewedByName}`);
  } else {
    lines.push("Waiting for a manager to review your submission.");
    const suggestion = [prospect.suggestedTerritoryName, prospect.suggestedRepName].filter(Boolean).join(" · ");
    if (suggestion) lines.push(`Suggested allocation: ${suggestion}`);
  }

  return (
    <View style={[styles.intakeBanner, { backgroundColor: bg }]}>
      <Feather name={icon} size={18} color={accent} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.intakeBannerTitle, { color: accent }]}>{title}</Text>
        {lines.map((l, i) => (
          <Text key={i} style={[styles.intakeBannerText, { color: accent }]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function SectionLabel({ colors, children }: { colors: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{children}</Text>;
}

function InfoRow({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  offlineMsg: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  backBtnLarge: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  backBtn: { padding: 4 },
  topTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  topSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  quickActions: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
  },
  quickBtn: { flex: 1, alignItems: "center", gap: 4 },
  quickBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  intakeBanner: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  intakeBannerTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  intakeBannerText: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  convertBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  convertBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  convertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  convertBannerText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  tabBarWrap: { borderBottomWidth: 1 },
  tabBar: { flexDirection: "row", paddingHorizontal: 16 },
  tab: { paddingVertical: 12, marginRight: 20, borderBottomWidth: 2 },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  groupLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 4,
    textTransform: "uppercase",
  },
  infoCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 2 },
  infoValue: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  taskCheck: { width: 28, alignItems: "center", justifyContent: "center" },
  rowAction: { padding: 4 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  rowSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  assigneeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  productTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  catalogBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  catalogBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  customBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  customBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  helperText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8, marginLeft: 4 },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  logBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  actForm: { marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  typeBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  typeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  formInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  formTextarea: { minHeight: 80, textAlignVertical: "top" },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 2 },
  cancelBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, minWidth: 80, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  catalogBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
  catalogBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  orLabel: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginVertical: 2 },
  selectedProduct: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
  selectedProductName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

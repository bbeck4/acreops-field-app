import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
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
  Contact,
  Customer,
  CustomerRep,
  CustomFieldDefinition,
  useArchiveVoiceNote,
  useAssignCustomerRep,
  useClaimCustomer,
  useCreateActivity,
  useCreateCustomerProduct,
  useDeleteActivity,
  useDeleteCustomerProduct,
  useDeleteVoiceNote,
  useGetCustomer,
  useGetQbInvoicesForCustomer,
  getListCustomerAdjustmentsQueryKey,
  useListCustomerActivities,
  useListCustomerAdjustments,
  useListCustomerBoundaries,
  useListCustomerContacts,
  useListCustomerCustomFields,
  useListCustomerFields,
  useListCustomerProducts,
  useListCustomerReps,
  useListCustomerWorkOrders,
  useListCustomFieldDefinitions,
  useListProducts,
  useSaveCustomerCustomFields,
  useUnclaimCustomer,
  useUpdateCustomer,
} from "@workspace/api-client-react";

import { ActivityItem } from "@/components/ActivityItem";
import { isAudioBackedActivity } from "@/lib/activityAudio";
import { CustomerAdjustments } from "@/components/CustomerAdjustments";
import { MediaGallery } from "@/components/MediaGallery";
import { ForwardVoiceNoteModal } from "@/components/ForwardVoiceNoteModal";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { TimeRecorder } from "@/components/TimeRecorder";
import { AdjustPinMap } from "@/components/AdjustPinMap";
import { ContactEditModal } from "@/components/ContactEditModal";
import { EditCustomerModal } from "@/components/EditCustomerModal";
import { CustomerFieldsMap, type FieldBoundaryEntry } from "@/components/CustomerFieldsMap";
import { CustomerMapPreview } from "@/components/CustomerMapPreview";
import { EmptyState } from "@/components/EmptyState";
import { OrderCard } from "@/components/OrderCard";
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";

type TabName = "overview" | "activity" | "orders" | "products" | "invoices" | "credits" | "fields" | "media";
const ACTIVITY_TYPES = ["note", "call", "visit", "email"] as const;

function cacheKey(id: number) {
  return `@agriops:customer:${id}`;
}

export default function CustomerDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const { isOnline, queueWrite } = useOffline();

  const [activeTab, setActiveTab] = useState<TabName>(
    tab === "activity" ? "activity" : "overview",
  );
  const [showForm, setShowForm] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>("note");
  const [actSubject, setActSubject] = useState("");
  const [actNotes, setActNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [cachedCustomer, setCachedCustomer] = useState<Customer | null>(null);
  const [isLoadingCache, setIsLoadingCache] = useState(false);

  const [productName, setProductName] = useState("");
  const [productQty, setProductQty] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null);
  const [showProductPicker, setShowProductPicker] = useState(false);

  const customerId = parseInt(id ?? "0", 10);

  const { data: customer, isLoading, refetch: refetchCustomer } = useGetCustomer(customerId);
  const { data: contacts } = useListCustomerContacts(customerId);
  const { data: workOrders } = useListCustomerWorkOrders(customerId);
  const { data: activities, refetch: refetchActivities } = useListCustomerActivities(customerId);
  const { data: invoices } = useGetQbInvoicesForCustomer(customerId);
  const { data: products, refetch: refetchProducts } = useListCustomerProducts(customerId);
  const { data: adjustments } = useListCustomerAdjustments(
    { customerId },
    {
      query: {
        enabled: !!customerId,
        queryKey: getListCustomerAdjustmentsQueryKey({ customerId }),
      },
    },
  );
  const { data: catalogProducts } = useListProducts();
  const { mutateAsync: createProductMutation } = useCreateCustomerProduct();
  const { mutateAsync: deleteProductMutation } = useDeleteCustomerProduct();
  const { mutateAsync: createActivityMutation } = useCreateActivity();
  const { mutateAsync: archiveVoiceMutation, isPending: isArchiving } = useArchiveVoiceNote();
  const { mutateAsync: deleteVoiceMutation, isPending: isDeletingVoice } = useDeleteVoiceNote();
  const { mutateAsync: deleteActivityMutation, isPending: isDeletingActivity } = useDeleteActivity();
  const [forwardingVoiceId, setForwardingVoiceId] = useState<number | null>(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const openNewContact = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingContact(null);
    setContactModalOpen(true);
  };
  const openEditContact = (c: Contact) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingContact(c);
    setContactModalOpen(true);
  };

  const handleArchiveVoice = (id: number) => {
    Alert.alert("Archive voice note?", "It will be hidden from the timeline but kept in the archive.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        onPress: async () => {
          try {
            await archiveVoiceMutation({ activityId: id });
            await refetchActivities();
          } catch {
            Alert.alert("Failed", "Could not archive voice note.");
          }
        },
      },
    ]);
  };

  const handleDeleteActivity = (id: number, label: string) => {
    Alert.alert(`Delete ${label}?`, "This entry will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteActivityMutation({ id });
            refetchActivities();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again");
          }
        },
      },
    ]);
  };

  const handleDeleteVoice = (id: number) => {
    Alert.alert("Delete voice note?", "The recording and transcript will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteVoiceMutation({ activityId: id });
            await refetchActivities();
          } catch {
            Alert.alert("Failed", "Could not delete voice note.");
          }
        },
      },
    ]);
  };
  const { data: fieldDefs } = useListCustomFieldDefinitions();
  const { data: fieldValues } = useListCustomerCustomFields(customerId);
  const saveFields = useSaveCustomerCustomFields();

  const { data: agFields } = useListCustomerFields(customerId);
  const { data: customerBoundaries } = useListCustomerBoundaries(customerId);

  const fieldMapEntries = React.useMemo<FieldBoundaryEntry[]>(() => {
    if (!customerBoundaries || customerBoundaries.length === 0) return [];
    const fieldLookup = new Map((agFields ?? []).map((f) => [f.id, f]));
    const byField = new Map<number, (typeof customerBoundaries)[number]>();
    for (const b of customerBoundaries) {
      const existing = byField.get(b.fieldId);
      if (!existing) { byField.set(b.fieldId, b); continue; }
      if (b.isActive && !existing.isActive) byField.set(b.fieldId, b);
    }
    return Array.from(byField.values()).map((b) => {
      const f = fieldLookup.get(b.fieldId);
      return {
        fieldId: b.fieldId,
        fieldName: f?.name ?? b.fieldName ?? `Field ${b.fieldId}`,
        cropPlan: f?.cropPlan ?? null,
        soilTestCount: f?.soilTestCount ?? 0,
        latestSoilTestDate: f?.latestSoilTestDate ?? null,
        geoJson: b.geoJson,
      };
    });
  }, [agFields, customerBoundaries]);

  // Rep claim / assignment
  const { data: customerReps, refetch: refetchReps } = useListCustomerReps(customerId);
  const { mutateAsync: claimCustomer } = useClaimCustomer();
  const { mutateAsync: unclaimCustomer } = useUnclaimCustomer();
  const { mutateAsync: assignRepRole } = useAssignCustomerRep();
  const [isClaimingRep, setIsClaimingRep] = useState(false);
  const [assigningMemberId, setAssigningMemberId] = useState<number | null>(null);

  const isManager = currentMember?.role === "manager" || currentMember?.role === "admin";
  const { canDo } = usePermissions();
  const canEdit = canDo("customers.edit");
  const canEditOrders = canDo("work_orders.edit");
  const myRep = customerReps?.find((r) => r.memberId === currentMember?.id);
  const isClaimed = !!myRep;
  const hasMultipleReps = (customerReps?.length ?? 0) >= 2;

  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>({});
  const [isSavingFields, setIsSavingFields] = useState(false);

  // GPS location state
  const [isCapturingLocation, setIsCapturingLocation] = useState(false);
  const [locationConfirm, setLocationConfirm] = useState<{ lat: number; lng: number } | null>(null);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [showClearLocationConfirm, setShowClearLocationConfirm] = useState(false);
  const [isClearingLocation, setIsClearingLocation] = useState(false);
  const [adjustPin, setAdjustPin] = useState<{ lat: number; lng: number } | null>(null);
  const [adjustLatText, setAdjustLatText] = useState("");
  const [adjustLngText, setAdjustLngText] = useState("");
  const [isSavingAdjust, setIsSavingAdjust] = useState(false);
  const { mutateAsync: updateCustomer } = useUpdateCustomer();
  const [showEditModal, setShowEditModal] = useState(false);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  useEffect(() => {
    if (customer) {
      AsyncStorage.setItem(cacheKey(customerId), JSON.stringify(customer)).catch(() => {});
    }
  }, [customer, customerId]);

  useEffect(() => {
    if (!customer && !isLoading) {
      setIsLoadingCache(true);
      AsyncStorage.getItem(cacheKey(customerId))
        .then((raw) => {
          if (raw) setCachedCustomer(JSON.parse(raw) as Customer);
        })
        .catch(() => {})
        .finally(() => setIsLoadingCache(false));
    }
  }, [customer, isLoading, customerId]);

  const displayCustomer = customer ?? cachedCustomer;
  const isFromCache = !customer && !!cachedCustomer;

  const primaryPhone = displayCustomer?.phones?.[0]?.value || displayCustomer?.phone || null;
  const callPhone = () => {
    if (primaryPhone) Linking.openURL(`tel:${primaryPhone}`);
  };

  const captureLocation = async () => {
    setIsCapturingLocation(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        alert("Location permission is required to set the customer location.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocationConfirm({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      alert("Could not get your location. Please try again.");
    } finally {
      setIsCapturingLocation(false);
    }
  };

  const saveLocation = async () => {
    if (!locationConfirm) return;
    setIsSavingLocation(true);
    try {
      await updateCustomer({ id: customerId, data: { lat: locationConfirm.lat, lng: locationConfirm.lng } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLocationConfirm(null);
      refetchCustomer();
    } catch {
      alert("Failed to save location. Please try again.");
    } finally {
      setIsSavingLocation(false);
    }
  };

  const openAdjustPin = () => {
    if (displayCustomer?.lat == null || displayCustomer?.lng == null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAdjustPin({ lat: displayCustomer.lat, lng: displayCustomer.lng });
    setAdjustLatText(displayCustomer.lat.toFixed(6));
    setAdjustLngText(displayCustomer.lng.toFixed(6));
  };

  const updateAdjustPin = (lat: number, lng: number) => {
    setAdjustPin({ lat, lng });
    setAdjustLatText(lat.toFixed(6));
    setAdjustLngText(lng.toFixed(6));
  };

  const commitAdjustText = () => {
    const lat = parseFloat(adjustLatText);
    const lng = parseFloat(adjustLngText);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      setAdjustPin({ lat, lng });
    }
  };

  const saveAdjustPin = async () => {
    if (!adjustPin) return;
    const lat = parseFloat(adjustLatText);
    const lng = parseFloat(adjustLngText);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      alert("Please enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    setIsSavingAdjust(true);
    try {
      await updateCustomer({ id: customerId, data: { lat, lng } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdjustPin(null);
      refetchCustomer();
    } catch {
      alert("Failed to update location. Please try again.");
    } finally {
      setIsSavingAdjust(false);
    }
  };

  const clearLocation = async () => {
    setIsClearingLocation(true);
    try {
      await updateCustomer({ id: customerId, data: { lat: null, lng: null } as unknown as { lat?: number; lng?: number } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowClearLocationConfirm(false);
      refetchCustomer();
    } catch {
      alert("Failed to clear location. Please try again.");
    } finally {
      setIsClearingLocation(false);
    }
  };

  const submitActivity = async () => {
    if (!actSubject.trim()) return;
    setIsSaving(true);
    const payload = {
      customerId,
      memberId: currentMember?.id,
      type: actType,
      subject: actSubject.trim(),
      notes: actNotes.trim() || undefined,
    };
    try {
      if (isOnline) {
        await createActivityMutation({ data: payload });
        refetchActivities();
      } else {
        await queueWrite("activity", payload);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
      setActSubject("");
      setActNotes("");
      setActType("note");
    } catch {
      await queueWrite("activity", payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setShowForm(false);
      setActSubject("");
      setActNotes("");
      setActType("note");
    } finally {
      setIsSaving(false);
    }
  };

  const resolvedProductName = selectedProduct ? selectedProduct.name : productName.trim();

  const submitProduct = async () => {
    if (!resolvedProductName || savingProduct) return;
    setSavingProduct(true);
    try {
      const match = catalogProducts?.find(
        (p) => p.name.toLowerCase() === productName.trim().toLowerCase(),
      );
      await createProductMutation({
        id: customerId,
        data: {
          productId: selectedProduct ? selectedProduct.id : match?.id,
          productName: resolvedProductName,
          quantity: productQty.trim() ? Number(productQty) : undefined,
        },
      });
      refetchProducts();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProductName("");
      setProductQty("");
      setSelectedProduct(null);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setSavingProduct(false);
    }
  };

  const removeProduct = async (productRowId: number) => {
    try {
      await deleteProductMutation({ id: productRowId });
      refetchProducts();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  if ((isLoading && !cachedCustomer) || isLoadingCache) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!displayCustomer) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="wifi-off" size={32} color={colors.mutedForeground} />
        <Text style={[styles.offlineMsg, { color: colors.mutedForeground }]}>
          Offline — no cached data for this customer
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.backBtnLarge, { borderColor: colors.border }]}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topPadding + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="back-button">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.topMeta}>
          <Text style={[styles.customerName, { color: colors.foreground }]} numberOfLines={1}>
            {displayCustomer.name}
          </Text>
          {displayCustomer.territory ? (
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
                {displayCustomer.territory}
              </Text>
            </View>
          ) : null}
          {isFromCache ? (
            <View style={[styles.cachedBadge, { backgroundColor: colors.muted }]}>
              <Feather name="wifi-off" size={10} color={colors.mutedForeground} />
              <Text style={[styles.badgeText, { color: colors.mutedForeground }]}> cached</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.topActions}>
          {currentMember && canEdit ? (
            <Pressable
              style={[
                styles.claimBtn,
                {
                  borderColor: isClaimed ? colors.primary : colors.border,
                  backgroundColor: isClaimed ? colors.accent : colors.card,
                  opacity: isClaimingRep ? 0.6 : 1,
                },
              ]}
              onPress={async () => {
                if (isClaimingRep) return;
                setIsClaimingRep(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                try {
                  if (isClaimed) {
                    await unclaimCustomer({ id: customerId });
                  } else {
                    await claimCustomer({ id: customerId });
                  }
                  refetchReps();
                } catch {
                  /* silent */
                } finally {
                  setIsClaimingRep(false);
                }
              }}
              disabled={isClaimingRep}
            >
              <Feather
                name={isClaimed ? "user-check" : "user-plus"}
                size={14}
                color={isClaimed ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.claimBtnText,
                  { color: isClaimed ? colors.primary : colors.mutedForeground },
                ]}
              >
                {isClaimed ? "Selected" : "Select"}
              </Text>
            </Pressable>
          ) : null}
          {customer && canEdit ? (
            <Pressable
              style={[styles.callBtn, { backgroundColor: colors.accent }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowEditModal(true);
              }}
              testID="edit-customer-btn"
            >
              <Feather name="edit-2" size={16} color={colors.primary} />
            </Pressable>
          ) : null}
          {primaryPhone ? (
            <Pressable style={[styles.callBtn, { backgroundColor: colors.accent }]} onPress={callPhone}>
              <Feather name="phone" size={17} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Tab bar — horizontally scrollable so the 8 sections don't squish
          together on narrow phone screens. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.tabBarContent}
      >
        {(["overview", "activity", "orders", "products", "invoices", "credits", "fields", "media"] as TabName[]).map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && {
                borderBottomColor: colors.primary,
                borderBottomWidth: 2,
              },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === tab ? colors.primary : colors.mutedForeground },
              ]}
            >
              {tab === "overview" ? "Info" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "activity" && activities?.length ? ` (${activities.length})` : ""}
              {tab === "orders" && workOrders?.length ? ` (${workOrders.length})` : ""}
              {tab === "products" && products?.length ? ` (${products.length})` : ""}
              {tab === "invoices" && invoices?.length ? ` (${invoices.length})` : ""}
              {tab === "credits" && adjustments?.length ? ` (${adjustments.length})` : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Overview ── */}
        {activeTab === "overview" ? (
          <View style={styles.overviewWrap}>
            <InfoRow label="Address">
              {[displayCustomer.address, displayCustomer.city, displayCustomer.state, displayCustomer.zip]
                .filter(Boolean)
                .join(", ") || "—"}
            </InfoRow>
            {canEdit && (
              <Pressable
                style={[
                  styles.setLocationBtn,
                  { borderColor: colors.border, backgroundColor: colors.card, opacity: isCapturingLocation ? 0.6 : 1 },
                ]}
                onPress={captureLocation}
                disabled={isCapturingLocation}
              >
                <Feather name="map-pin" size={15} color={colors.primary} />
                <Text style={[styles.setLocationBtnText, { color: colors.primary }]}>
                  {isCapturingLocation ? "Getting location…" : displayCustomer.lat != null ? "Update location" : "Set location"}
                </Text>
                {displayCustomer.lat != null ? (
                  <Text style={[styles.setLocationCoords, { color: colors.mutedForeground }]}>
                    {displayCustomer.lat.toFixed(5)}, {displayCustomer.lng?.toFixed(5)}
                  </Text>
                ) : null}
              </Pressable>
            )}
            {displayCustomer.lat != null && displayCustomer.lng != null ? (
              <CustomerMapPreview
                lat={displayCustomer.lat}
                lng={displayCustomer.lng}
                label={displayCustomer.name}
                primaryColor={colors.primary}
                borderColor={colors.border}
              />
            ) : null}
            {displayCustomer.lat != null && canEdit ? (
              <View style={styles.locationActionsRow}>
                <Pressable
                  style={[styles.locationActionBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={openAdjustPin}
                  testID="adjust-pin-btn"
                >
                  <Feather name="move" size={14} color={colors.primary} />
                  <Text style={[styles.locationActionText, { color: colors.primary }]}>
                    Adjust pin
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.locationActionBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowClearLocationConfirm(true);
                  }}
                  testID="clear-location-btn"
                >
                  <Feather name="x-circle" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.locationActionText, { color: colors.mutedForeground }]}>
                    Clear
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {(displayCustomer.phones && displayCustomer.phones.length > 0) ? (
              displayCustomer.phones.map((p, i) => (
                <InfoRow key={i} label={p.label || "Phone"}>
                  <Text
                    style={{ color: colors.primary }}
                    onPress={() => Linking.openURL(`tel:${p.value}`)}
                  >
                    {p.value}
                  </Text>
                </InfoRow>
              ))
            ) : displayCustomer.phone ? (
              <InfoRow label="Phone">
                <Text style={{ color: colors.primary }} onPress={callPhone}>{displayCustomer.phone}</Text>
              </InfoRow>
            ) : null}
            {displayCustomer.email ? <InfoRow label="Email">{displayCustomer.email}</InfoRow> : null}
            {displayCustomer.repName ? <InfoRow label="Sales Rep">{displayCustomer.repName}</InfoRow> : null}
            {displayCustomer.notes ? <InfoRow label="Notes">{displayCustomer.notes}</InfoRow> : null}

            {canEdit && (
            <Pressable
              style={[
                styles.voiceNoteCta,
                { backgroundColor: "#ef4444", shadowColor: "#ef4444" },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowVoice(true);
              }}
              testID="voice-note-info-btn"
            >
              <View style={styles.voiceNoteCtaIcon}>
                <Feather name="mic" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.voiceNoteCtaTitle}>Record Voice Note</Text>
                <Text style={styles.voiceNoteCtaSubtitle}>
                  Auto-transcribed and saved to activity log
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color="#fff" />
            </Pressable>
            )}

            {canEdit && (
            <Pressable
              style={[
                styles.voiceNoteCta,
                { backgroundColor: "#f59e0b", shadowColor: "#f59e0b" },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowTime(true);
              }}
              testID="time-record-info-btn"
            >
              <View style={styles.voiceNoteCtaIcon}>
                <Feather name="clock" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.voiceNoteCtaTitle}>Record Time</Text>
                <Text style={styles.voiceNoteCtaSubtitle}>
                  Track time on site, attach to a work order if billable
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color="#fff" />
            </Pressable>
            )}

            <Pressable
              style={[
                styles.setLocationBtn,
                { borderColor: colors.border, backgroundColor: colors.card, marginTop: 4 },
              ]}
              onPress={() => router.push(`/recommendations/${customerId}` as never)}
              testID="ag-recommendations-link"
            >
              <Feather name="layers" size={15} color={colors.primary} />
              <Text style={[styles.setLocationBtnText, { color: colors.primary }]}>
                Accepted prescriptions
              </Text>
              <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
            </Pressable>

            {/* Rep Assignment Panel */}
            {customerReps && customerReps.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
                  Reps {isManager && hasMultipleReps ? "— Assign Roles" : ""}
                </Text>
                {customerReps.map((rep) => {
                  const roleColor =
                    rep.role === "primary"
                      ? colors.primary
                      : rep.role === "secondary"
                      ? "#8b5cf6"
                      : colors.mutedForeground;
                  return (
                    <View
                      key={rep.id}
                      style={[
                        styles.repRow,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <View style={[styles.repAvatar, { backgroundColor: colors.accent }]}>
                        <Text style={[styles.repInitials, { color: colors.primary }]}>
                          {rep.memberName
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.repInfo}>
                        <Text style={[styles.repName, { color: colors.foreground }]}>
                          {rep.memberName}
                          {rep.memberId === currentMember?.id ? " (you)" : ""}
                        </Text>
                        <Text style={[styles.repRoleBadge, { color: roleColor }]}>
                          {rep.role === "claimed" ? "Interested" : rep.role}
                        </Text>
                      </View>
                      {isManager && hasMultipleReps ? (
                        <View style={styles.assignBtns}>
                          {(["primary", "secondary"] as const).map((r) => (
                            <Pressable
                              key={r}
                              style={[
                                styles.assignBtn,
                                {
                                  borderColor:
                                    rep.role === r ? roleColor : colors.border,
                                  backgroundColor:
                                    rep.role === r ? roleColor + "22" : "transparent",
                                  opacity: assigningMemberId === rep.memberId ? 0.5 : 1,
                                },
                              ]}
                              onPress={async () => {
                                if (assigningMemberId) return;
                                setAssigningMemberId(rep.memberId);
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                try {
                                  await assignRepRole({
                                    id: customerId,
                                    memberId: rep.memberId,
                                    data: { role: rep.role === r ? "claimed" : r },
                                  });
                                  refetchReps();
                                } catch {
                                  /* silent */
                                } finally {
                                  setAssigningMemberId(null);
                                }
                              }}
                              disabled={!!assigningMemberId}
                            >
                              <Text
                                style={[
                                  styles.assignBtnText,
                                  {
                                    color:
                                      rep.role === r ? roleColor : colors.mutedForeground,
                                  },
                                ]}
                              >
                                {r === "primary" ? "1°" : "2°"}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {fieldMapEntries.length > 0 ? (
              <View style={{ marginTop: 8, marginBottom: 8 }}>
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Field Map</Text>
                <CustomerFieldsMap
                  fields={fieldMapEntries}
                  height={180}
                  borderColor={colors.border}
                  primaryColor={colors.primary}
                />
              </View>
            ) : null}

            <Pressable
              style={[styles.fieldsLinkBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/customer-fields/${customerId}` as never);
              }}
              testID="view-fields-btn"
            >
              <View style={[styles.fieldsLinkIcon, { backgroundColor: colors.accent }]}>
                <Feather name="map" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldsLinkTitle, { color: colors.foreground }]}>Fields</Text>
                <Text style={[styles.fieldsLinkSubtitle, { color: colors.mutedForeground }]}>
                  View boundaries and synced layer data
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>

            <View style={{ marginTop: 8 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <Text style={[styles.sectionLabel, { color: colors.foreground, marginBottom: 0 }]}>
                  Contacts
                </Text>
                {canEdit && (
                <Pressable
                  onPress={openNewContact}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  testID="add-contact-btn"
                >
                  <Feather name="plus" size={16} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                    Add
                  </Text>
                </Pressable>
                )}
              </View>
              {contacts && contacts.length > 0 ? (
                contacts.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={canEdit ? () => openEditContact(c) : undefined}
                    style={({ pressed }) => [
                      styles.contactRow,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    testID={`contact-row-${c.id}`}
                  >
                    <View style={[styles.contactAvatar, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.contactInitials, { color: colors.accentForeground }]}>
                        {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={[styles.contactName, { color: colors.foreground }]}>{c.name}</Text>
                      {c.title ? (
                        <Text style={[styles.contactMeta, { color: colors.mutedForeground }]}>
                          {c.title}
                        </Text>
                      ) : null}
                      {c.phone ? (
                        <Text style={[styles.contactMeta, { color: colors.primary }]}>{c.phone}</Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </Pressable>
                ))
              ) : canEdit ? (
                <Pressable
                  onPress={openNewContact}
                  style={[
                    styles.contactRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderStyle: "dashed",
                      justifyContent: "center",
                    },
                  ]}
                  testID="add-first-contact-btn"
                >
                  <Feather name="user-plus" size={16} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginLeft: 8 }}>
                    Add a contact
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── Activity ── */}
        {activeTab === "activity" ? (
          <View>
            {canEdit && (
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
              <Pressable
                style={[styles.logBtn, { backgroundColor: colors.primary, flex: 1, marginHorizontal: 0, marginBottom: 0 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowForm(true);
                }}
                testID="log-activity-btn"
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Log Activity</Text>
              </Pressable>
              <Pressable
                style={[styles.logBtn, { backgroundColor: "#ef4444", flex: 1, marginHorizontal: 0, marginBottom: 0 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowVoice(true);
                }}
                testID="voice-note-btn"
              >
                <Feather name="mic" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Voice</Text>
              </Pressable>
            </View>
            )}

            {showForm ? (
              <View
                style={[
                  styles.actForm,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {!isOnline ? (
                  <View style={[styles.offlineNote, { backgroundColor: colors.muted }]}>
                    <Feather name="wifi-off" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.offlineNoteText, { color: colors.mutedForeground }]}>
                      Offline — activity will sync when back online
                    </Text>
                  </View>
                ) : null}
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
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
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
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
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
                    <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.saveBtn,
                      { backgroundColor: colors.primary, opacity: !actSubject.trim() || isSaving ? 0.5 : 1 },
                    ]}
                    onPress={submitActivity}
                    disabled={!actSubject.trim() || isSaving}
                  >
                    <Text style={styles.saveBtnText}>{isSaving ? "Saving…" : "Save"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {!activities?.length ? (
              <EmptyState
                icon="activity"
                title="No activity logged"
                subtitle="Tap Log Activity to record a call, visit, or note"
              />
            ) : (
              <View style={{ paddingTop: 8 }}>
                {activities.map((act, idx) => {
                  const isVoice = isAudioBackedActivity(act) || act.type === "voice_note";
                  const isTime = act.type === "time";
                  const isOwn = currentMember?.id != null && act.memberId === currentMember.id;
                  const woNumber = act.workOrderId
                    ? workOrders?.find((w) => w.id === act.workOrderId)?.orderNumber ?? `#${act.workOrderId}`
                    : null;
                  return (
                    <ActivityItem
                      key={act.id}
                      type={act.type}
                      subtype={act.subtype ?? null}
                      subject={act.subject}
                      notes={act.notes ?? null}
                      memberName={act.memberName ?? null}
                      createdAt={act.createdAt}
                      isLast={idx === activities.length - 1}
                      workOrderNumber={woNumber}
                      durationMinutes={act.durationMinutes ?? null}
                      billable={!!act.billable}
                      activityId={act.id}
                      audioPath={act.audioPath ?? null}
                      audioContext="customer"
                      onArchive={isVoice ? () => handleArchiveVoice(act.id) : undefined}
                      onDelete={
                        isVoice
                          ? () => handleDeleteVoice(act.id)
                          : !isVoice && isOwn
                          ? () => handleDeleteActivity(act.id, isTime ? "time entry" : "activity")
                          : undefined
                      }
                      onForward={isVoice ? () => setForwardingVoiceId(act.id) : undefined}
                      busy={
                        (isVoice && (isArchiving || isDeletingVoice)) ||
                        (!isVoice && isDeletingActivity)
                      }
                    />
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {/* ── Orders ── */}
        {activeTab === "orders" ? (
          <View>
            {canEditOrders && (
            <Pressable
              style={[styles.logBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/order/new")}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.logBtnText}>New Order</Text>
            </Pressable>
            )}
            {!workOrders?.length ? (
              <EmptyState
                icon="clipboard"
                title="No orders yet"
                subtitle="No work orders for this customer"
              />
            ) : (
              workOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  id={order.id}
                  customerName={displayCustomer.name}
                  status={order.status}
                  createdAt={order.createdAt}
                />
              ))
            )}
          </View>
        ) : null}

        {/* ── Interested Products ── */}
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
                      <Text style={[styles.productRowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
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
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: resolvedProductName && !savingProduct ? 1 : 0.5, flexDirection: "row", gap: 6 }]}
                  onPress={submitProduct}
                  disabled={!resolvedProductName || savingProduct}
                >
                  {savingProduct ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="plus" size={16} color="#fff" />
                      <Text style={styles.saveBtnText}>Add product</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
            )}

            {!products || products.length === 0 ? (
              <EmptyState icon="package" title="No interested products yet" subtitle="Track which products this customer wants." />
            ) : (
              products.map((p) => {
                const isCatalog = p.productId != null;
                return (
                  <View key={p.id} style={[styles.productRowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather
                      name={isCatalog ? "package" : "edit-3"}
                      size={18}
                      color={isCatalog ? colors.primary : colors.mutedForeground}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.productTitleRow}>
                        <Text style={[styles.productRowTitle, { color: colors.foreground }]} numberOfLines={1}>
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
                      <Text style={[styles.productRowSub, { color: colors.mutedForeground }]}>
                        {p.sku ? `${p.sku}  ·  ` : ""}
                        {p.quantity != null ? `Qty ${p.quantity.toLocaleString()}` : "Qty —"}
                      </Text>
                    </View>
                    {canEdit && (
                      <Pressable hitSlop={8} onPress={() => removeProduct(p.id)}>
                        <Feather name="trash-2" size={18} color={colors.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* ── Custom Fields ── */}
        {activeTab === "fields" ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {!fieldDefs || fieldDefs.length === 0 ? (
              <EmptyState
                icon="sliders"
                title="No custom fields"
                subtitle="Ask your admin to define custom fields in settings"
              />
            ) : (
              <>
                {fieldDefs.map((def) => {
                  const saved = fieldValues?.find((v) => v.fieldDefinitionId === def.id);
                  const current = fieldEdits[def.id] !== undefined ? fieldEdits[def.id] : (saved?.value ?? "");

                  let dropdownOptions: string[] = [];
                  if (def.fieldType === "dropdown" && def.options) {
                    try { dropdownOptions = JSON.parse(def.options) as string[]; } catch { /* fallback to text */ }
                  }
                  const isDropdown = def.fieldType === "dropdown" && dropdownOptions.length > 0;

                  return (
                    <View key={def.id} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{def.label}</Text>
                      {isDropdown ? (
                        <>
                          <Pressable
                            style={[styles.fieldInput, { borderColor: colors.border, backgroundColor: colors.background, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                            onPress={canEdit ? () => setFieldEdits((prev) => ({ ...prev, [`__picker_${def.id}`]: "open" })) : undefined}
                          >
                            <Text style={{ color: current ? colors.foreground : colors.mutedForeground }}>
                              {current || `Select ${def.label.toLowerCase()}…`}
                            </Text>
                            <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
                          </Pressable>
                          <Modal
                            visible={fieldEdits[`__picker_${def.id}`] === "open"}
                            transparent
                            animationType="slide"
                            onRequestClose={() => setFieldEdits((prev) => { const n: Record<string, string> = { ...prev }; delete n[`__picker_${def.id}`]; return n; })}
                          >
                            <Pressable style={styles.pickerOverlay} onPress={() => setFieldEdits((prev) => { const n: Record<string, string> = { ...prev }; delete n[`__picker_${def.id}`]; return n; })}>

                              <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
                                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>{def.label}</Text>
                                {dropdownOptions.map((opt) => (
                                  <Pressable
                                    key={opt}
                                    style={[styles.pickerOption, { borderColor: colors.border, backgroundColor: opt === current ? colors.primary + "22" : "transparent" }]}
                                    onPress={() => setFieldEdits((prev) => { const n: Record<string, string> = { ...prev, [def.id]: opt }; delete n[`__picker_${def.id}`]; return n; })}
                                  >
                                    <Text style={{ color: colors.foreground, fontWeight: opt === current ? "600" : "400" }}>{opt}</Text>
                                    {opt === current && <Feather name="check" size={14} color={colors.primary} />}
                                  </Pressable>
                                ))}
                              </View>
                            </Pressable>
                          </Modal>
                        </>
                      ) : (
                        <TextInput
                          style={[styles.fieldInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }]}
                          value={current}
                          editable={canEdit}
                          onChangeText={(v) => setFieldEdits((prev) => ({ ...prev, [def.id]: v }))}
                          placeholder={def.fieldType === "date" ? "YYYY-MM-DD" : `Enter ${def.label.toLowerCase()}…`}
                          placeholderTextColor={colors.mutedForeground}
                          keyboardType={def.fieldType === "number" ? "numeric" : "default"}
                        />
                      )}
                    </View>
                  );
                })}
                {canEdit && (
                <Pressable
                  style={[styles.saveFieldsBtn, { backgroundColor: colors.primary, opacity: isSavingFields ? 0.6 : 1 }]}
                  disabled={isSavingFields}
                  onPress={async () => {
                    setIsSavingFields(true);
                    try {
                      const values = Object.entries(fieldEdits)
                        .filter(([defId]) => !defId.startsWith("__picker_"))
                        .map(([defId, value]) => ({
                          fieldDefinitionId: parseInt(defId),
                          value,
                        }));
                      if (values.length > 0) {
                        await saveFields.mutateAsync({ id: customerId, data: { values } });
                        setFieldEdits({});
                      }
                    } catch {}
                    setIsSavingFields(false);
                  }}
                >
                  <Text style={styles.saveFieldsBtnText}>{isSavingFields ? "Saving…" : "Save Custom Fields"}</Text>
                </Pressable>
                )}
              </>
            )}
          </View>
        ) : null}

        {/* ── Invoices ── */}
        {activeTab === "invoices" ? (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {!invoices?.length ? (
              <EmptyState
                icon="file-text"
                title="No invoices synced"
                subtitle="QB invoices will appear here after syncing"
              />
            ) : (
              invoices.map((inv) => (
                <View
                  key={inv.id}
                  style={[styles.invoiceCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.invoiceRow}>
                    <Text style={[styles.invoiceNum, { color: colors.foreground }]}>
                      {inv.qbInvoiceNum ? `#${inv.qbInvoiceNum}` : `QB-${inv.qbInvoiceId}`}
                    </Text>
                    <View
                      style={[
                        styles.invoiceStatus,
                        {
                          backgroundColor:
                            inv.status === "Paid"
                              ? colors.accent
                              : inv.balance && inv.balance > 0
                              ? "#fef3c7"
                              : colors.muted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.invoiceStatusText,
                          {
                            color:
                              inv.status === "Paid"
                                ? colors.primary
                                : inv.balance && inv.balance > 0
                                ? "#92400e"
                                : colors.mutedForeground,
                          },
                        ]}
                      >
                        {inv.status ?? "Unknown"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.invoiceRow}>
                    <Text style={[styles.invoiceMeta, { color: colors.mutedForeground }]}>
                      {inv.txnDate ? new Date(inv.txnDate).toLocaleDateString() : "—"}
                    </Text>
                    <View style={styles.invoiceAmounts}>
                      {inv.totalAmount != null ? (
                        <Text style={[styles.invoiceTotal, { color: colors.foreground }]}>
                          ${Number(inv.totalAmount).toFixed(2)}
                        </Text>
                      ) : null}
                      {inv.balance != null && inv.balance > 0 ? (
                        <Text style={[styles.invoiceBalance, { color: "#b45309" }]}>
                          ${Number(inv.balance).toFixed(2)} due
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {inv.dueDate ? (
                    <Text style={[styles.invoiceDue, { color: colors.mutedForeground }]}>
                      Due {new Date(inv.dueDate).toLocaleDateString()}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}

        {activeTab === "credits" ? (
          <CustomerAdjustments customerId={customerId} canEdit={canEditOrders} />
        ) : null}

        {activeTab === "media" ? (
          <MediaGallery context={{ customerId }} canDelete={isManager} />
        ) : null}
      </ScrollView>

      {/* GPS Location Confirmation Modal */}
      <Modal
        visible={!!locationConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setLocationConfirm(null)}
      >
        <View style={styles.locationOverlay}>
          <View style={[styles.locationSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.locationIconWrap, { backgroundColor: colors.accent }]}>
              <Feather name="map-pin" size={22} color={colors.primary} />
            </View>
            <Text style={[styles.locationTitle, { color: colors.foreground }]}>Save this location?</Text>
            <Text style={[styles.locationSubtitle, { color: colors.mutedForeground }]}>
              This will pin {displayCustomer.name}'s location to your current GPS coordinates.
            </Text>
            {locationConfirm ? (
              <View style={[styles.coordsBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.coordsLabel, { color: colors.mutedForeground }]}>Latitude</Text>
                <Text style={[styles.coordsValue, { color: colors.foreground }]}>{locationConfirm.lat.toFixed(6)}</Text>
                <Text style={[styles.coordsLabel, { color: colors.mutedForeground, marginTop: 6 }]}>Longitude</Text>
                <Text style={[styles.coordsValue, { color: colors.foreground }]}>{locationConfirm.lng.toFixed(6)}</Text>
              </View>
            ) : null}
            <View style={styles.locationActions}>
              <Pressable
                style={[styles.locationCancelBtn, { borderColor: colors.border }]}
                onPress={() => setLocationConfirm(null)}
                disabled={isSavingLocation}
              >
                <Text style={[styles.locationCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.locationSaveBtn, { backgroundColor: colors.primary, opacity: isSavingLocation ? 0.6 : 1 }]}
                onPress={saveLocation}
                disabled={isSavingLocation}
              >
                <Feather name="check" size={15} color="#fff" />
                <Text style={styles.locationSaveText}>{isSavingLocation ? "Saving…" : "Save location"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Clear Location Confirmation Modal */}
      <Modal
        visible={showClearLocationConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearLocationConfirm(false)}
      >
        <View style={styles.locationOverlay}>
          <View style={[styles.locationSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.locationIconWrap, { backgroundColor: colors.muted }]}>
              <Feather name="x-circle" size={22} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.locationTitle, { color: colors.foreground }]}>Clear saved location?</Text>
            <Text style={[styles.locationSubtitle, { color: colors.mutedForeground }]}>
              This will remove the pinned GPS coordinates for {displayCustomer.name}. You can set a new location later.
            </Text>
            <View style={styles.locationActions}>
              <Pressable
                style={[styles.locationCancelBtn, { borderColor: colors.border }]}
                onPress={() => setShowClearLocationConfirm(false)}
                disabled={isClearingLocation}
              >
                <Text style={[styles.locationCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.locationSaveBtn, { backgroundColor: "#dc2626", opacity: isClearingLocation ? 0.6 : 1 }]}
                onPress={clearLocation}
                disabled={isClearingLocation}
                testID="confirm-clear-location-btn"
              >
                <Feather name="trash-2" size={15} color="#fff" />
                <Text style={styles.locationSaveText}>{isClearingLocation ? "Clearing…" : "Clear location"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Adjust Pin Modal */}
      <Modal
        visible={!!adjustPin}
        transparent
        animationType="fade"
        onRequestClose={() => setAdjustPin(null)}
      >
        <View style={styles.locationOverlay}>
          <View
            style={[
              styles.locationSheet,
              { backgroundColor: colors.card, borderColor: colors.border, alignItems: "stretch" },
            ]}
          >
            <View style={{ alignItems: "center", gap: 4 }}>
              <View style={[styles.locationIconWrap, { backgroundColor: colors.accent }]}>
                <Feather name="move" size={22} color={colors.primary} />
              </View>
              <Text style={[styles.locationTitle, { color: colors.foreground }]}>Adjust pin</Text>
              <Text style={[styles.locationSubtitle, { color: colors.mutedForeground }]}>
                Drag the map under the pin, or type exact coordinates below.
              </Text>
            </View>
            {adjustPin ? (
              <AdjustPinMap
                lat={adjustPin.lat}
                lng={adjustPin.lng}
                onChange={updateAdjustPin}
                primaryColor={colors.primary}
                borderColor={colors.border}
              />
            ) : null}
            <View style={styles.adjustInputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.coordsLabel, { color: colors.mutedForeground }]}>Latitude</Text>
                <TextInput
                  value={adjustLatText}
                  onChangeText={setAdjustLatText}
                  onBlur={commitAdjustText}
                  onEndEditing={commitAdjustText}
                  keyboardType="numbers-and-punctuation"
                  placeholder="-90 to 90"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.adjustInput,
                    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
                  ]}
                  testID="adjust-lat-input"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.coordsLabel, { color: colors.mutedForeground }]}>Longitude</Text>
                <TextInput
                  value={adjustLngText}
                  onChangeText={setAdjustLngText}
                  onBlur={commitAdjustText}
                  onEndEditing={commitAdjustText}
                  keyboardType="numbers-and-punctuation"
                  placeholder="-180 to 180"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.adjustInput,
                    { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
                  ]}
                  testID="adjust-lng-input"
                />
              </View>
            </View>
            <View style={styles.locationActions}>
              <Pressable
                style={[styles.locationCancelBtn, { borderColor: colors.border }]}
                onPress={() => setAdjustPin(null)}
                disabled={isSavingAdjust}
              >
                <Text style={[styles.locationCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.locationSaveBtn,
                  { backgroundColor: colors.primary, opacity: isSavingAdjust ? 0.6 : 1 },
                ]}
                onPress={saveAdjustPin}
                disabled={isSavingAdjust}
                testID="save-adjust-pin-btn"
              >
                <Feather name="check" size={15} color="#fff" />
                <Text style={styles.locationSaveText}>{isSavingAdjust ? "Saving…" : "Save pin"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <VoiceNoteRecorder
        entityType="customer"
        entityId={customerId}
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        onSaved={() => {
          refetchActivities();
          setActiveTab("activity");
        }}
      />

      <TimeRecorder
        customerId={customerId}
        visible={showTime}
        onClose={() => setShowTime(false)}
        onSaved={() => {
          refetchActivities();
          setActiveTab("activity");
        }}
      />

      {customer ? (
        <EditCustomerModal
          customer={customer}
          visible={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSaved={() => refetchCustomer()}
        />
      ) : null}

      <ContactEditModal
        visible={contactModalOpen}
        customerId={customerId}
        contact={editingContact}
        onClose={() => setContactModalOpen(false)}
      />

      <ForwardVoiceNoteModal
        visible={forwardingVoiceId !== null}
        voiceNoteId={forwardingVoiceId}
        currentMemberId={currentMember?.id}
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
        onSelect={(p) => {
          setSelectedProduct(p);
          setProductName("");
          setShowProductPicker(false);
        }}
      />
    </View>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
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
  topMeta: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  customerName: { fontSize: 18, fontFamily: "Inter_700Bold", flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  cachedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  claimBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  callBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  repRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
    gap: 10,
  },
  repAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  repInitials: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  repInfo: { flex: 1 },
  repName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  repRoleBadge: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  assignBtns: { flexDirection: "row", gap: 6 },
  assignBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  assignBtnText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  tabBar: { borderBottomWidth: 1, flexGrow: 0 },
  tabBarContent: { paddingHorizontal: 4, alignItems: "center" },
  tab: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  overviewWrap: { paddingHorizontal: 16, gap: 8 },
  infoCard: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 4 },
  infoLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 15, fontFamily: "Inter_500Medium" },
  sectionLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  contactAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  contactInitials: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  contactMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  logBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  offlineNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderRadius: 6,
  },
  offlineNoteText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  actForm: { marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: 10, borderWidth: 1, gap: 10 },
  typeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  typeBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  formInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  formTextarea: { minHeight: 70, textAlignVertical: "top" },
  formActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  catalogBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
  catalogBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  orLabel: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  selectedProduct: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
  selectedProductName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  productRowCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  productTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  productRowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  productRowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  catalogBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  catalogBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  customBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  customBadgeText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  invoiceCard: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 6 },
  invoiceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  invoiceNum: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  invoiceStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  invoiceStatusText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  invoiceMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  invoiceAmounts: { flexDirection: "row", gap: 8, alignItems: "center" },
  invoiceTotal: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  invoiceBalance: { fontSize: 12, fontFamily: "Inter_500Medium" },
  invoiceDue: { fontSize: 12, fontFamily: "Inter_400Regular" },
  fieldCard: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  fieldInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: "Inter_400Regular" },
  saveFieldsBtn: { paddingVertical: 13, borderRadius: 10, alignItems: "center", marginTop: 4 },
  saveFieldsBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, paddingBottom: 32, paddingHorizontal: 16, gap: 4 },
  pickerTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  pickerOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, marginBottom: 4 },
  setLocationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexWrap: "wrap",
  },
  voiceNoteCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    marginTop: 4,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  voiceNoteCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  voiceNoteCtaTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  voiceNoteCtaSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.9)", marginTop: 2 },
  setLocationBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  setLocationCoords: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clearLocationBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: -4,
  },
  clearLocationBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  locationActionsRow: { flexDirection: "row", gap: 8, marginTop: -4 },
  locationActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  locationActionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  adjustInputRow: { flexDirection: "row", gap: 10 },
  adjustInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  locationOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  locationSheet: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  locationIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  locationTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  locationSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  coordsBox: {
    width: "100%",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  coordsLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  coordsValue: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  locationActions: { flexDirection: "row", gap: 10, marginTop: 4, width: "100%" },
  locationCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  locationCancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  locationSaveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  locationSaveText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldsLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  fieldsLinkIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  fieldsLinkTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldsLinkSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});

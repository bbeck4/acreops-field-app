import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getListMembersQueryKey, useCreateProspect, useListMembers } from "@workspace/api-client-react";

import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

// Fields the AI can read off a photographed business/contact card. All
// nullable — the scan is a best-effort pre-fill the user reviews.
interface BusinessCardScanResult {
  businessName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

// Ask the user for a card photo: camera or library.
function chooseCardAsset(): Promise<ImagePicker.ImagePickerAsset | null> {
  return new Promise((resolve) => {
    Alert.alert(
      "Scan contact card",
      "Choose a source",
      [
        {
          text: "Take photo",
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert("Permission needed", "Camera access is required to take photos.");
              resolve(null);
              return;
            }
            const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
            resolve(!r.canceled && r.assets[0] ? r.assets[0] : null);
          },
        },
        {
          text: "Choose from library",
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert("Permission needed", "Library access is required to choose photos.");
              resolve(null);
              return;
            }
            const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
            resolve(!r.canceled && r.assets[0] ? r.assets[0] : null);
          },
        },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export default function NewProspectScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const role = (currentMember?.role ?? "").toLowerCase();
  const isManager = role === "manager" || role === "admin";
  const { data: members } = useListMembers(undefined, { query: { queryKey: getListMembersQueryKey(), enabled: isManager } });

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [territory, setTerritory] = useState("");
  const [primaryCrop, setPrimaryCrop] = useState("");
  const [totalAcres, setTotalAcres] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [ownerId, setOwnerId] = useState<number | null>(currentMember?.id ?? null);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const { getToken } = useAuth();

  const { mutateAsync: createProspect } = useCreateProspect();

  // Photograph (or pick) a contact card and let the AI pre-fill the form.
  // Only blank fields are filled so anything already typed is never clobbered.
  const scanCard = async () => {
    if (isScanning) return;
    const asset = await chooseCardAsset();
    if (!asset) return;
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    const token = domain ? await getToken() : null;
    if (!domain || !token) {
      Alert.alert("Scan unavailable", "Check your connection and try again.");
      return;
    }
    setIsScanning(true);
    try {
      const resp = await fetch(asset.uri);
      const blob = await resp.blob();
      const contentType = asset.mimeType || blob.type || "image/jpeg";
      const scanRes = await fetch(`https://${domain}/api/prospects/scan-business-card`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
        body: blob,
      });
      if (!scanRes.ok) throw new Error(`scan failed: ${scanRes.status}`);
      const data = (await scanRes.json()) as BusinessCardScanResult;
      // Functional updates so a value typed while the scan was in flight is
      // never clobbered — only fields still blank at resolution get filled.
      const fill = (next: string | null, set: React.Dispatch<React.SetStateAction<string>>) => {
        if (next) set((current) => (current.trim() ? current : next));
      };
      fill(data.businessName, setBusinessName);
      fill(data.contactName, setContactName);
      fill(data.email, setEmail);
      fill(data.phone, setPhone);
      fill(data.address, setAddress);
      fill(data.city, setCity);
      fill(data.state, setState);
      const foundAny = Boolean(
        data.businessName || data.contactName || data.email || data.phone ||
        data.address || data.city || data.state,
      );
      if (foundAny) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        foundAny ? "Card scanned" : "Nothing detected",
        foundAny
          ? "We filled in what we could read. Review the details before saving."
          : "We couldn't read the card. Enter the details manually.",
      );
    } catch {
      Alert.alert("Scan failed", "Couldn't read the card. Enter the details manually.");
    } finally {
      setIsScanning(false);
    }
  };

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const canSubmit = businessName.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || isSaving) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const acres = totalAcres.trim() ? Number(totalAcres.trim()) : undefined;
      const value = estimatedValue.trim() ? Number(estimatedValue.trim()) : undefined;
      const newProspect = await createProspect({
        data: {
          businessName: businessName.trim(),
          contactName: contactName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          territory: territory.trim() || undefined,
          primaryCrop: primaryCrop.trim() || undefined,
          totalAcres: acres != null && !Number.isNaN(acres) ? acres : undefined,
          estimatedValue: value != null && !Number.isNaN(value) ? value : undefined,
          ownerId: ownerId ?? undefined,
          notes: notes.trim() || undefined,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/prospect/${newProspect.id}` as never);
    } catch {
      Alert.alert("Error", "Could not create prospect. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          { paddingTop: topPadding + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>New Prospect</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: canSubmit && !isSaving ? 1 : 0.4 }]}
          onPress={submit}
          disabled={!canSubmit || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Pressable
            onPress={scanCard}
            disabled={isScanning}
            style={[
              styles.scanBtn,
              { borderColor: colors.primary, backgroundColor: colors.card, opacity: isScanning ? 0.6 : 1 },
            ]}
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="camera" size={18} color={colors.primary} />
            )}
            <Text style={[styles.scanBtnText, { color: colors.primary }]}>
              {isScanning ? "Reading card…" : "Scan a contact card"}
            </Text>
          </Pressable>
          <Text style={[styles.scanHint, { color: colors.mutedForeground }]}>
            Snap a photo of a business card to fill in the fields below — or just type them in.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>REQUIRED</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field
              label="Business Name"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Green Acres Farm"
              colors={colors}
              autoCapitalize="words"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>CONTACT</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Contact" value={contactName} onChangeText={setContactName} placeholder="Jane Farmer" colors={colors} autoCapitalize="words" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="contact@farm.com" colors={colors} keyboardType="email-address" autoCapitalize="none" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" colors={colors} keyboardType="phone-pad" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LOCATION</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Street Address" value={address} onChangeText={setAddress} placeholder="123 Farm Road" colors={colors} autoCapitalize="words" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Field label="City" value={city} onChangeText={setCity} placeholder="Springfield" colors={colors} autoCapitalize="words" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field label="State" value={state} onChangeText={setState} placeholder="IL" colors={colors} autoCapitalize="characters" />
              </View>
              <View style={[styles.vertDivider, { backgroundColor: colors.border }]} />
              <View style={{ flex: 1 }}>
                <Field label="Territory" value={territory} onChangeText={setTerritory} placeholder="Central" colors={colors} autoCapitalize="words" />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>FARM & SALES</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Primary Crop" value={primaryCrop} onChangeText={setPrimaryCrop} placeholder="Corn, soybeans…" colors={colors} autoCapitalize="words" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Field label="Total Acres" value={totalAcres} onChangeText={setTotalAcres} placeholder="0" colors={colors} keyboardType="numeric" />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Field label="Est. Value ($)" value={estimatedValue} onChangeText={setEstimatedValue} placeholder="0" colors={colors} keyboardType="numeric" />
          </View>
        </View>

        {isManager ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>OWNER</Text>
            <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.chipWrap}>
                {(members ?? []).map((m) => {
                  const selected = ownerId === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setOwnerId(selected ? null : m.id)}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : colors.background,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>
                        {m.name}
                      </Text>
                    </Pressable>
                  );
                })}
                {(members ?? []).length === 0 ? (
                  <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>No team members found.</Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTES</Text>
          <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.textarea, { color: colors.foreground }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes about this prospect…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { color: colors.foreground }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        returnKeyType="next"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 4 },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  content: { padding: 16, gap: 0 },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 4,
  },
  fieldGroup: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    width: 110,
  },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  divider: { height: 1, marginLeft: 14 },
  rowFields: { flexDirection: "row" },
  vertDivider: { width: 1 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular" },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
  },
  scanBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scanHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6, marginLeft: 4 },
  textarea: {
    padding: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 90,
    textAlignVertical: "top",
  },
});

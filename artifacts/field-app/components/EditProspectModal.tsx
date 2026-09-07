import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Prospect,
  useListProspectLeadSources,
  useUpdateProspect,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

// Mirrors the shared PROSPECT_STATUSES list (lib/db schema) and the web UI.
const STATUSES = ["new", "contacted", "qualified", "nurturing", "lost", "converted"] as const;
const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  nurturing: "Nurturing",
  lost: "Lost",
  converted: "Converted",
};

type Props = {
  prospect: Prospect;
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export function EditProspectModal({ prospect, visible, onClose, onSaved }: Props) {
  const colors = useColors();
  const { mutateAsync: updateProspect, isPending } = useUpdateProspect();
  const { data: leadSources } = useListProspectLeadSources();

  const [businessName, setBusinessName] = useState(prospect.businessName);
  const [contactName, setContactName] = useState(prospect.contactName ?? "");
  const [title, setTitle] = useState(prospect.title ?? "");
  const [email, setEmail] = useState(prospect.email ?? "");
  const [phone, setPhone] = useState(prospect.phone ?? "");
  const [address, setAddress] = useState(prospect.address ?? "");
  const [city, setCity] = useState(prospect.city ?? "");
  const [stateText, setStateText] = useState(prospect.state ?? "");
  const [zip, setZip] = useState(prospect.zip ?? "");
  const [county, setCounty] = useState(prospect.county ?? "");

  const [primaryCrop, setPrimaryCrop] = useState(prospect.primaryCrop ?? "");
  const [totalAcres, setTotalAcres] = useState(prospect.totalAcres?.toString() ?? "");
  const [irrigationType, setIrrigationType] = useState(prospect.irrigationType ?? "");
  const [tillagePractice, setTillagePractice] = useState(prospect.tillagePractice ?? "");
  const [livestock, setLivestock] = useState(prospect.livestock ?? "");
  const [equipmentNotes, setEquipmentNotes] = useState(prospect.equipmentNotes ?? "");

  const [status, setStatus] = useState(prospect.status);
  const [rating, setRating] = useState(prospect.rating ?? "");
  const [leadSource, setLeadSource] = useState(prospect.leadSource ?? "");
  const [estimatedValue, setEstimatedValue] = useState(prospect.estimatedValue?.toString() ?? "");
  const [nextStep, setNextStep] = useState(prospect.nextStep ?? "");
  const [nextStepDueDate, setNextStepDueDate] = useState(
    prospect.nextStepDueDate ? String(prospect.nextStepDueDate).slice(0, 10) : "",
  );
  const [decisionMakerRole, setDecisionMakerRole] = useState(prospect.decisionMakerRole ?? "");
  const [currentSupplier, setCurrentSupplier] = useState(prospect.currentSupplier ?? "");
  const [contractRenewalMonth, setContractRenewalMonth] = useState(
    prospect.contractRenewalMonth?.toString() ?? "",
  );
  const [needsAndWants, setNeedsAndWants] = useState(prospect.needsAndWants ?? "");
  const [lostReason, setLostReason] = useState(prospect.lostReason ?? "");

  useEffect(() => {
    if (!visible) return;
    setBusinessName(prospect.businessName);
    setContactName(prospect.contactName ?? "");
    setTitle(prospect.title ?? "");
    setEmail(prospect.email ?? "");
    setPhone(prospect.phone ?? "");
    setAddress(prospect.address ?? "");
    setCity(prospect.city ?? "");
    setStateText(prospect.state ?? "");
    setZip(prospect.zip ?? "");
    setCounty(prospect.county ?? "");
    setPrimaryCrop(prospect.primaryCrop ?? "");
    setTotalAcres(prospect.totalAcres?.toString() ?? "");
    setIrrigationType(prospect.irrigationType ?? "");
    setTillagePractice(prospect.tillagePractice ?? "");
    setLivestock(prospect.livestock ?? "");
    setEquipmentNotes(prospect.equipmentNotes ?? "");
    setStatus(prospect.status);
    setRating(prospect.rating ?? "");
    setLeadSource(prospect.leadSource ?? "");
    setEstimatedValue(prospect.estimatedValue?.toString() ?? "");
    setNextStep(prospect.nextStep ?? "");
    setNextStepDueDate(prospect.nextStepDueDate ? String(prospect.nextStepDueDate).slice(0, 10) : "");
    setDecisionMakerRole(prospect.decisionMakerRole ?? "");
    setCurrentSupplier(prospect.currentSupplier ?? "");
    setContractRenewalMonth(prospect.contractRenewalMonth?.toString() ?? "");
    setNeedsAndWants(prospect.needsAndWants ?? "");
    setLostReason(prospect.lostReason ?? "");
    // Only reset when the modal opens, not on every prospect refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canSubmit = businessName.trim().length > 0 && !isPending;

  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const submit = async () => {
    if (!canSubmit) return;
    if (status === "lost" && !lostReason.trim()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Reason required", "Enter a reason before marking this prospect as Lost.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateProspect({
        id: prospect.id,
        data: {
          businessName: businessName.trim(),
          contactName: contactName.trim() || null,
          title: title.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          state: stateText.trim() || null,
          zip: zip.trim() || null,
          county: county.trim() || null,
          primaryCrop: primaryCrop.trim() || null,
          totalAcres: numOrNull(totalAcres),
          irrigationType: irrigationType.trim() || null,
          tillagePractice: tillagePractice.trim() || null,
          livestock: livestock.trim() || null,
          equipmentNotes: equipmentNotes.trim() || null,
          status,
          rating: rating.trim() || null,
          leadSource: leadSource.trim() || null,
          estimatedValue: numOrNull(estimatedValue),
          nextStep: nextStep.trim() || null,
          nextStepDueDate: nextStepDueDate.trim() || null,
          decisionMakerRole: decisionMakerRole.trim() || null,
          currentSupplier: currentSupplier.trim() || null,
          contractRenewalMonth: numOrNull(contractRenewalMonth),
          needsAndWants: needsAndWants.trim() || null,
          lostReason: status === "lost" ? lostReason.trim() || null : null,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved?.();
      onClose();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Failed to save", "Could not update prospect. Please try again.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose} style={styles.headerBtn} disabled={isPending}>
              <Text style={[styles.headerCancel, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>Edit Prospect</Text>
            <Pressable
              onPress={submit}
              style={[
                styles.headerBtn,
                styles.saveBtn,
                { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.4 },
              ]}
              disabled={!canSubmit}
              testID="edit-prospect-save-btn"
            >
              {isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Section label="BUSINESS" colors={colors}>
              <Field label="Business" value={businessName} onChangeText={setBusinessName} colors={colors} required autoCapitalize="words" />
              <Divider colors={colors} />
              <Field label="Contact" value={contactName} onChangeText={setContactName} colors={colors} autoCapitalize="words" />
              <Divider colors={colors} />
              <Field label="Title" value={title} onChangeText={setTitle} colors={colors} placeholder="Owner, Agronomist…" autoCapitalize="words" />
            </Section>

            <Section label="CONTACT INFO" colors={colors}>
              <Field label="Email" value={email} onChangeText={setEmail} colors={colors} keyboardType="email-address" autoCapitalize="none" placeholder="contact@farm.com" />
              <Divider colors={colors} />
              <Field label="Phone" value={phone} onChangeText={setPhone} colors={colors} keyboardType="phone-pad" />
            </Section>

            <Section label="ADDRESS" colors={colors}>
              <Field label="Street" value={address} onChangeText={setAddress} colors={colors} placeholder="123 Farm Road" autoCapitalize="words" />
              <Divider colors={colors} />
              <Field label="City" value={city} onChangeText={setCity} colors={colors} placeholder="Springfield" autoCapitalize="words" />
              <Divider colors={colors} />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field label="State" value={stateText} onChangeText={setStateText} colors={colors} autoCapitalize="characters" placeholder="IL" />
                </View>
                <View style={[styles.vDivider, { backgroundColor: colors.border }]} />
                <View style={{ flex: 1 }}>
                  <Field label="ZIP" value={zip} onChangeText={setZip} colors={colors} keyboardType="numeric" placeholder="62701" />
                </View>
              </View>
              <Divider colors={colors} />
              <Field label="County" value={county} onChangeText={setCounty} colors={colors} autoCapitalize="words" />
            </Section>

            <Section label="STATUS" colors={colors}>
              <View style={styles.chipWrap}>
                {STATUSES.map((s) => {
                  const selected = status === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setStatus(s);
                      }}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : colors.background,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>
                        {STATUS_LABELS[s]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {status === "lost" ? (
              <Section label="LOST REASON" colors={colors}>
                <Field label="Reason" value={lostReason} onChangeText={setLostReason} colors={colors} placeholder="Why was this lost?" required />
              </Section>
            ) : null}

            <Section label="SALES" colors={colors}>
              <Field label="Rating" value={rating} onChangeText={setRating} colors={colors} placeholder="A / B / C" />
              <Divider colors={colors} />
              <Field label="Est. value" value={estimatedValue} onChangeText={setEstimatedValue} colors={colors} keyboardType="numeric" placeholder="$" />
              <Divider colors={colors} />
              <Field label="Next step" value={nextStep} onChangeText={setNextStep} colors={colors} />
              <Divider colors={colors} />
              <Field label="Due date" value={nextStepDueDate} onChangeText={setNextStepDueDate} colors={colors} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            </Section>

            <Section label="LEAD SOURCE" colors={colors}>
              <View style={styles.chipWrap}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setLeadSource("");
                  }}
                  style={[
                    styles.chip,
                    {
                      borderColor: leadSource === "" ? colors.primary : colors.border,
                      backgroundColor: leadSource === "" ? colors.primary : colors.background,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: leadSource === "" ? "#fff" : colors.foreground }]}>
                    None
                  </Text>
                </Pressable>
                {(leadSources ?? []).map((s) => {
                  const selected = leadSource === s.name;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setLeadSource(s.name);
                      }}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : colors.background,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section label="FARM OPERATION" colors={colors}>
              <Field label="Primary crop" value={primaryCrop} onChangeText={setPrimaryCrop} colors={colors} autoCapitalize="words" />
              <Divider colors={colors} />
              <Field label="Total acres" value={totalAcres} onChangeText={setTotalAcres} colors={colors} keyboardType="numeric" />
              <Divider colors={colors} />
              <Field label="Irrigation" value={irrigationType} onChangeText={setIrrigationType} colors={colors} placeholder="Pivot, drip…" />
              <Divider colors={colors} />
              <Field label="Tillage" value={tillagePractice} onChangeText={setTillagePractice} colors={colors} placeholder="No-till, conventional…" />
              <Divider colors={colors} />
              <Field label="Livestock" value={livestock} onChangeText={setLivestock} colors={colors} />
              <Divider colors={colors} />
              <Field label="Equipment" value={equipmentNotes} onChangeText={setEquipmentNotes} colors={colors} multiline />
            </Section>

            <Section label="SALES CONTEXT" colors={colors}>
              <Field label="Decision role" value={decisionMakerRole} onChangeText={setDecisionMakerRole} colors={colors} placeholder="Decision-maker role" />
              <Divider colors={colors} />
              <Field label="Supplier" value={currentSupplier} onChangeText={setCurrentSupplier} colors={colors} placeholder="Current supplier" />
              <Divider colors={colors} />
              <Field label="Renewal mo." value={contractRenewalMonth} onChangeText={setContractRenewalMonth} colors={colors} keyboardType="numeric" placeholder="1-12" />
              <Divider colors={colors} />
              <Field label="Needs/wants" value={needsAndWants} onChangeText={setNeedsAndWants} colors={colors} multiline />
            </Section>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Divider({ colors }: { colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

function Section({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.fieldGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  colors,
  keyboardType,
  autoCapitalize,
  placeholder,
  required,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useColors>;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TextInput
        style={[styles.fieldInput, { color: colors.foreground }, multiline && styles.fieldInputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { height: "92%", borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: "hidden" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerBtn: { paddingHorizontal: 8, paddingVertical: 6, minWidth: 60 },
  headerCancel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  saveBtn: { borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 18 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 4,
  },
  fieldGroup: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  fieldRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_500Medium", width: 96 },
  fieldInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  fieldInputMultiline: { minHeight: 40, textAlignVertical: "top" },
  divider: { height: 1, marginLeft: 14 },
  row: { flexDirection: "row" },
  vDivider: { width: 1 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});

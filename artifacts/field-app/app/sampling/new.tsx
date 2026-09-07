import { Feather } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
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

import {
  createSamplingPlan,
  getListFieldSamplingPlansQueryKey,
  useListFieldSamplingPlans,
} from "@workspace/api-client-react";

import { CustomerPickerModal, FieldPickerModal } from "@/components/CustomerFieldPickers";
import { useColors } from "@/hooks/useColors";

const SAMPLE_TYPES: { value: string; label: string }[] = [
  { value: "soil", label: "Soil" },
  { value: "tissue", label: "Tissue" },
  { value: "sap", label: "Sap" },
];

function defaultPlanName(): string {
  const today = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Field sampling – ${today}`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NewSamplingPlanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // A pre-printed bag label the rep scanned with no matching sample. We carry it
  // through to the build screen so the first point claims it instead of
  // auto-generating a code.
  const params = useLocalSearchParams<{ pendingCode?: string }>();
  const pendingCode = params.pendingCode?.trim()
    ? params.pendingCode.replace(/\s+/g, "").toUpperCase()
    : null;
  const buildQuery = (id: number | string) =>
    `/sampling/build?planId=${id}${pendingCode ? `&pendingCode=${encodeURIComponent(pendingCode)}` : ""}`;

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string>("");
  const [fieldId, setFieldId] = useState<number | null>(null);
  const [fieldName, setFieldName] = useState<string>("");

  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [showFieldPicker, setShowFieldPicker] = useState(false);

  const [name, setName] = useState(defaultPlanName());
  const [sampleTypes, setSampleTypes] = useState<string[]>(["soil"]);
  const [creating, setCreating] = useState(false);

  // Existing plans for the chosen field — offer to open instead of duplicating.
  const { data: existingPlans, isLoading: loadingExisting } = useListFieldSamplingPlans(
    fieldId ?? 0,
    {
      query: {
        queryKey: getListFieldSamplingPlansQueryKey(fieldId ?? 0),
        enabled: fieldId != null,
      },
    },
  );

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const onSelectCustomer = (id: number, cname: string) => {
    setCustomerId(id);
    setCustomerName(cname);
    setFieldId(null);
    setFieldName("");
    setShowCustomerPicker(false);
  };

  const onSelectField = (id: number, fname: string) => {
    setFieldId(id);
    setFieldName(fname);
    setShowFieldPicker(false);
  };

  const toggleSampleType = (value: string) => {
    setSampleTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    );
  };

  const canCreate = fieldId != null && name.trim().length > 0 && sampleTypes.length > 0 && !creating;

  const createPlan = async () => {
    if (fieldId == null || !canCreate) return;
    setCreating(true);
    try {
      const plan = await createSamplingPlan({
        fieldId,
        customerId: customerId ?? undefined,
        name: name.trim(),
        season: String(new Date().getFullYear()),
        sampleTypes,
        status: "in_progress",
      });
      router.replace(buildQuery(plan.id) as never);
    } catch (err) {
      Alert.alert(
        "Couldn't create plan",
        err instanceof Error ? err.message : "Check your connection and try again.",
      );
    } finally {
      setCreating(false);
    }
  };

  const hasExisting = (existingPlans ?? []).length > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          { paddingTop: topPadding + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="back-button">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          Sample a field
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
      >
        {pendingCode ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              padding: 12,
              borderRadius: 10,
              backgroundColor: colors.muted,
            }}
          >
            <Feather name="tag" size={16} color={colors.primary} />
            <Text style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
              Label “{pendingCode}” will be attached to your first sample point.
            </Text>
          </View>
        ) : null}
        <Text style={[styles.lead, { color: colors.mutedForeground }]}>
          Pick a customer and field, then create a plan to drop sample points on the spot.
        </Text>

        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Pressable
            onPress={() => setShowCustomerPicker(true)}
            style={[styles.selectRow, { borderColor: colors.border, backgroundColor: colors.background }]}
            testID="select-customer"
          >
            <Text style={[styles.selectLabel, { color: colors.mutedForeground }]}>Customer</Text>
            <Text
              style={[styles.selectValue, { color: customerName ? colors.foreground : colors.mutedForeground }]}
              numberOfLines={1}
            >
              {customerName || "Select customer…"}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <Pressable
            onPress={() => customerId != null && setShowFieldPicker(true)}
            disabled={customerId == null}
            style={[
              styles.selectRow,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                opacity: customerId == null ? 0.5 : 1,
              },
            ]}
            testID="select-field"
          >
            <Text style={[styles.selectLabel, { color: colors.mutedForeground }]}>Field</Text>
            <Text
              style={[styles.selectValue, { color: fieldName ? colors.foreground : colors.mutedForeground }]}
              numberOfLines={1}
            >
              {fieldName || "Select field…"}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {fieldId != null ? (
          loadingExisting ? (
            <ActivityIndicator color={colors.primary} />
          ) : hasExisting ? (
            <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Existing plans for this field
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Open an existing plan to keep sampling it, or create a new one below.
              </Text>
              {(existingPlans ?? []).map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.replace(buildQuery(p.id) as never)}
                  style={[styles.existingRow, { borderColor: colors.border, backgroundColor: colors.background }]}
                  testID={`existing-plan-${p.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.existingName, { color: colors.foreground }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[styles.note, { color: colors.mutedForeground }]}>
                      {titleCase(p.status)} · {p.sampleCount ?? 0}{" "}
                      {(p.sampleCount ?? 0) === 1 ? "point" : "points"}
                    </Text>
                  </View>
                  <Feather name="arrow-up-right" size={18} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          ) : null
        ) : null}

        {fieldId != null ? (
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>New plan</Text>
            <View style={{ gap: 6 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Plan name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Plan name"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Sample types</Text>
              <View style={styles.chipRow}>
                {SAMPLE_TYPES.map((t) => {
                  const on = sampleTypes.includes(t.value);
                  return (
                    <Pressable
                      key={t.value}
                      onPress={() => toggleSampleType(t.value)}
                      style={[
                        styles.chip,
                        {
                          borderColor: on ? colors.primary : colors.border,
                          backgroundColor: on ? colors.primary : colors.background,
                        },
                      ]}
                      testID={`sample-type-${t.value}`}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: on ? colors.primaryForeground : colors.foreground },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={createPlan}
          disabled={!canCreate}
          style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: canCreate ? 1 : 0.5 }]}
          testID="create-plan-button"
        >
          {creating ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="plus" size={18} color={colors.primaryForeground} />
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Create plan & add points
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      <CustomerPickerModal
        visible={showCustomerPicker}
        onClose={() => setShowCustomerPicker(false)}
        onSelect={onSelectCustomer}
      />
      <FieldPickerModal
        visible={showFieldPicker}
        customerId={customerId}
        onClose={() => setShowFieldPicker(false)}
        onSelect={onSelectField}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_700Bold" },
  lead: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  section: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  note: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectLabel: { fontSize: 13, width: 70, fontFamily: "Inter_400Regular" },
  selectValue: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  existingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  existingName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  inputLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});

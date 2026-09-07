import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { router, Stack } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CustomerPickerModal, FieldPickerModal } from "@/components/CustomerFieldPickers";
import { useColors } from "@/hooks/useColors";

// Soil-test columns the scan can pre-fill, mirrored from the server's
// analytesToSoilTestColumns() mapping. Order = display order on the form.
type SoilColumn =
  | "ph"
  | "bufferPh"
  | "organicMatter"
  | "cec"
  | "phosphorus"
  | "potassium"
  | "calcium"
  | "magnesium"
  | "sulfur"
  | "zinc"
  | "manganese"
  | "iron"
  | "copper"
  | "boron"
  | "baseSatCa"
  | "baseSatMg"
  | "baseSatK"
  | "baseSatNa"
  | "baseSatH";

const MACRO_FIELDS: Array<{ key: SoilColumn; label: string; unit: string }> = [
  { key: "ph", label: "pH", unit: "" },
  { key: "bufferPh", label: "Buffer pH", unit: "" },
  { key: "organicMatter", label: "Organic Matter", unit: "%" },
  { key: "cec", label: "CEC", unit: "meq/100g" },
  { key: "phosphorus", label: "Phosphorus (P)", unit: "ppm" },
  { key: "potassium", label: "Potassium (K)", unit: "ppm" },
  { key: "calcium", label: "Calcium (Ca)", unit: "ppm" },
  { key: "magnesium", label: "Magnesium (Mg)", unit: "ppm" },
  { key: "sulfur", label: "Sulfur (S)", unit: "ppm" },
];

const MICRO_FIELDS: Array<{ key: SoilColumn; label: string; unit: string }> = [
  { key: "zinc", label: "Zinc (Zn)", unit: "ppm" },
  { key: "manganese", label: "Manganese (Mn)", unit: "ppm" },
  { key: "iron", label: "Iron (Fe)", unit: "ppm" },
  { key: "copper", label: "Copper (Cu)", unit: "ppm" },
  { key: "boron", label: "Boron (B)", unit: "ppm" },
];

const BASE_SAT_FIELDS: Array<{ key: SoilColumn; label: string; unit: string }> = [
  { key: "baseSatCa", label: "Base Sat Ca", unit: "%" },
  { key: "baseSatMg", label: "Base Sat Mg", unit: "%" },
  { key: "baseSatK", label: "Base Sat K", unit: "%" },
  { key: "baseSatNa", label: "Base Sat Na", unit: "%" },
  { key: "baseSatH", label: "Base Sat H", unit: "%" },
];

type ScanResponse = {
  reportDate: string | null;
  labNumber: string | null;
  sampleType: string;
  fieldHint: string | null;
  analytes: Array<{ analyteCode: string; value: number | null }>;
  soilTest?: Partial<Record<SoilColumn, number>>;
  pageCount?: number;
  pagesScanned?: number;
};

type Step = "pick" | "scanning" | "review" | "saving";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function QuickScanSoilReportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [step, setStep] = useState<Step>("pick");
  const [scanError, setScanError] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);

  // Extracted / editable values.
  const [values, setValues] = useState<Record<string, string>>({});
  const [sampleDate, setSampleDate] = useState(todayIso());
  const [labName, setLabName] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldHint, setFieldHint] = useState<string | null>(null);
  const [sampleType, setSampleType] = useState<string>("soil");
  const [pageInfo, setPageInfo] = useState<{ pageCount: number; pagesScanned: number } | null>(null);

  // Field confirmation (required before save).
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<number | null>(null);
  const [fieldName, setFieldName] = useState<string | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [showFieldPicker, setShowFieldPicker] = useState(false);

  const setVal = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  const uploadAndScan = useCallback(
    async (uri: string, contentType: string, filename: string) => {
      const pdf = contentType.includes("application/pdf");
      setIsPdf(pdf);
      setPhotoUri(uri);
      setStep("scanning");
      setScanError(null);
      try {
        const token = await getToken();
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (!token || !domain) throw new Error("Not authenticated");
        const blob = await (await fetch(uri)).blob();
        const res = await fetch(`https://${domain}/api/precision-ag/scan-soil-report`, {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "x-filename": encodeURIComponent(filename),
            Authorization: `Bearer ${token}`,
          },
          body: blob,
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({ error: "Extraction failed" }))) as {
            error?: string;
          };
          throw new Error(errBody.error ?? "Extraction failed");
        }
        const result = (await res.json()) as ScanResponse;
        const next: Record<string, string> = {};
        const soil = result.soilTest ?? {};
        for (const [k, v] of Object.entries(soil)) {
          if (v != null) next[k] = String(v);
        }
        setValues(next);
        setSampleDate(result.reportDate ?? todayIso());
        setLabName(result.labNumber ?? "");
        setFieldHint(result.fieldHint);
        setSampleType(result.sampleType ?? "soil");
        setPageInfo(
          result.pageCount != null && result.pagesScanned != null
            ? { pageCount: result.pageCount, pagesScanned: result.pagesScanned }
            : null,
        );
        setStep("review");
      } catch (err) {
        setScanError(
          err instanceof Error
            ? err.message
            : "Could not read this report. Try a clearer photo and try again.",
        );
        setStep("pick");
      }
    },
    [getToken],
  );

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to scan a report.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    void uploadAndScan(asset.uri, asset.mimeType ?? "image/jpeg", asset.fileName ?? `scan-${Date.now()}.jpg`);
  }, [uploadAndScan]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photos access needed", "Allow photo library access to pick a report image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    void uploadAndScan(asset.uri, asset.mimeType ?? "image/jpeg", asset.fileName ?? `scan-${Date.now()}.jpg`);
  }, [uploadAndScan]);

  const pickPdf = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    void uploadAndScan(asset.uri, asset.mimeType ?? "application/pdf", asset.name ?? `report-${Date.now()}.pdf`);
  }, [uploadAndScan]);

  const onSelectCustomer = useCallback((id: number, name: string) => {
    setCustomerId(id);
    setCustomerName(name);
    setFieldId(null);
    setFieldName(null);
    setShowCustomerPicker(false);
  }, []);

  const onSelectField = useCallback((id: number, name: string) => {
    setFieldId(id);
    setFieldName(name);
    setShowFieldPicker(false);
  }, []);

  const save = useCallback(async () => {
    if (!fieldId) {
      Alert.alert("Confirm the field", "Select the field this soil report belongs to before saving.");
      return;
    }
    // CreateSoilTestBody uses .optional() (not .nullable()), so omit blank
    // fields entirely rather than sending null (null would 400).
    const num = (s: string | undefined): number | undefined => {
      if (s == null || s.trim() === "") return undefined;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    setStep("saving");
    try {
      const token = await getToken();
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!token || !domain) throw new Error("Not authenticated");
      const body: Record<string, unknown> = {
        sampleDate: (sampleDate || todayIso()) + "T00:00:00.000Z",
      };
      if (labName.trim()) body.labName = labName.trim();
      if (notes.trim()) body.notes = notes.trim();
      for (const f of [...MACRO_FIELDS, ...MICRO_FIELDS, ...BASE_SAT_FIELDS]) {
        const n = num(values[f.key]);
        if (n !== undefined) body[f.key] = n;
      }
      const res = await fetch(`https://${domain}/api/ag-fields/${fieldId}/soil-tests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({ error: "Save failed" }))) as { error?: string };
        throw new Error(errBody.error ?? "Save failed");
      }
      Alert.alert("Saved", `Soil test recorded for ${fieldName ?? "the field"}.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      setStep("review");
      Alert.alert("Could not save", err instanceof Error ? err.message : "Save failed");
    }
  }, [fieldId, fieldName, getToken, labName, notes, sampleDate, values]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-button">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          Scan Soil Report
        </Text>
        <View style={styles.iconBtn} />
      </View>

      {step === "pick" ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}>
          <Text style={[styles.lead, { color: colors.mutedForeground }]}>
            Take a photo of a lab soil report — no sampling plan needed. The values are read automatically,
            then you confirm which field the results belong to.
          </Text>
          {scanError ? (
            <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
              <Feather name="alert-triangle" size={16} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{scanError}</Text>
            </View>
          ) : null}
          <Pressable
            onPress={takePhoto}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            testID="take-photo"
          >
            <Feather name="camera" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Take a photo</Text>
          </Pressable>
          <Pressable
            onPress={pickPhoto}
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            testID="pick-photo"
          >
            <Feather name="image" size={18} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Choose from library</Text>
          </Pressable>
          <Pressable
            onPress={pickPdf}
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            testID="pick-pdf"
          >
            <Feather name="file-text" size={18} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Upload a PDF</Text>
          </Pressable>
        </ScrollView>
      ) : step === "scanning" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.scanningText, { color: colors.mutedForeground }]}>
            Reading the report…
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {photoUri && !isPdf ? (
            <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
          ) : null}
          {pageInfo && pageInfo.pagesScanned < pageInfo.pageCount ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Scanned the first {pageInfo.pagesScanned} of {pageInfo.pageCount} pages. Add any missing values
              manually.
            </Text>
          ) : null}
          {sampleType !== "soil" ? (
            <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
              <Feather name="alert-triangle" size={16} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>
                This looks like a {sampleType} report, not a soil report. Values weren’t pre-filled — enter
                them manually only if this really is a soil test.
              </Text>
            </View>
          ) : null}

          {/* Field confirmation — required */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Confirm field</Text>
            {fieldHint ? (
              <View style={[styles.hintBox, { backgroundColor: colors.muted }]}>
                <Feather name="cpu" size={14} color={colors.mutedForeground} />
                <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                  Report says: “{fieldHint}”
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={() => setShowCustomerPicker(true)}
              style={[styles.selectRow, { borderColor: colors.border }]}
            >
              <Text style={[styles.selectLabel, { color: colors.mutedForeground }]}>Customer</Text>
              <Text style={[styles.selectValue, { color: customerName ? colors.foreground : colors.mutedForeground }]}>
                {customerName ?? "Select customer"}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={() => {
                if (!customerId) {
                  Alert.alert("Select a customer first", "Pick the customer, then choose the field.");
                  return;
                }
                setShowFieldPicker(true);
              }}
              style={[styles.selectRow, { borderColor: colors.border, opacity: customerId ? 1 : 0.5 }]}
            >
              <Text style={[styles.selectLabel, { color: colors.mutedForeground }]}>Field</Text>
              <Text style={[styles.selectValue, { color: fieldName ? colors.foreground : colors.mutedForeground }]}>
                {fieldName ?? "Select field"}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Report meta */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Report details</Text>
            <LabeledInput label="Sample date" value={sampleDate} onChangeText={setSampleDate} placeholder="YYYY-MM-DD" colors={colors} />
            <LabeledInput label="Lab" value={labName} onChangeText={setLabName} placeholder="Lab name / number" colors={colors} />
          </View>

          {/* Macros */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Soil values</Text>
            {MACRO_FIELDS.map((f) => (
              <LabeledInput
                key={f.key}
                label={f.unit ? `${f.label} (${f.unit})` : f.label}
                value={values[f.key] ?? ""}
                onChangeText={(v) => setVal(f.key, v)}
                keyboardType="decimal-pad"
                colors={colors}
              />
            ))}
          </View>

          {/* Micros */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Micronutrients</Text>
            {MICRO_FIELDS.map((f) => (
              <LabeledInput
                key={f.key}
                label={`${f.label} (${f.unit})`}
                value={values[f.key] ?? ""}
                onChangeText={(v) => setVal(f.key, v)}
                keyboardType="decimal-pad"
                colors={colors}
              />
            ))}
          </View>

          {/* Base saturation (% of CEC) */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Base saturation (% of CEC)</Text>
            {BASE_SAT_FIELDS.map((f) => (
              <LabeledInput
                key={f.key}
                label={`${f.label} (${f.unit})`}
                value={values[f.key] ?? ""}
                onChangeText={(v) => setVal(f.key, v)}
                keyboardType="decimal-pad"
                colors={colors}
              />
            ))}
          </View>

          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notes</Text>
            <TextInput
              style={[styles.notesInput, { color: colors.foreground, borderColor: colors.border }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
              placeholderTextColor={colors.mutedForeground}
              multiline
            />
          </View>
        </ScrollView>
      )}

      {step === "review" || step === "saving" ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable
            onPress={save}
            disabled={!fieldId || step === "saving"}
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !fieldId || step === "saving" ? 0.5 : 1 }]}
            testID="save-soil-test"
          >
            {step === "saving" ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="check" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                  {fieldId ? "Save soil test" : "Confirm a field to save"}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

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

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "decimal-pad" | "default";
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? "—"}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "700", textAlign: "center" },
  lead: { fontSize: 14, lineHeight: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  scanningText: { fontSize: 14 },
  preview: { width: "100%", height: 180, borderRadius: 12 },
  note: { fontSize: 13, lineHeight: 18 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: "600" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { flex: 1, fontSize: 13 },
  section: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  hintBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, padding: 10 },
  hintText: { flex: 1, fontSize: 13 },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectLabel: { fontSize: 13, width: 70 },
  selectValue: { flex: 1, fontSize: 15, fontWeight: "500" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fieldLabel: { flex: 1, fontSize: 14 },
  fieldInput: {
    width: 120,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    textAlign: "right",
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: "top",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});

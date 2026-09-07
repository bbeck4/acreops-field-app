import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useCreateWorkItem,
  useListCustomers,
  useListCustomerEquipment,
  getListCustomerEquipmentQueryKey,
} from "@workspace/api-client-react";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useColors } from "@/hooks/useColors";

// Open a service ticket from the field. The tech picks a customer (and
// optionally a piece of their equipment), describes the problem, and the
// ticket goes straight into the manager queue.
export default function NewServiceTicketScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const initialCustomerId = params.customerId ? parseInt(params.customerId, 10) : undefined;

  const [customerId, setCustomerId] = useState<number | undefined>(initialCustomerId);
  const [customerFilter, setCustomerFilter] = useState("");
  const [summary, setSummary] = useState("");
  const [equipmentId, setEquipmentId] = useState<number | undefined>(undefined);
  const [kind, setKind] = useState<"service_job" | "install_job">("service_job");
  const [submitting, setSubmitting] = useState(false);

  const { data: customers } = useListCustomers();
  const { data: equipment } = useListCustomerEquipment(customerId ?? 0, {
    query: { enabled: !!customerId, queryKey: getListCustomerEquipmentQueryKey(customerId ?? 0) },
  });
  const create = useCreateWorkItem();

  const filteredCustomers = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    return (customers ?? []).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 20);
  }, [customers, customerFilter]);

  const onSubmit = async () => {
    if (!customerId || !summary.trim()) {
      Alert.alert("Missing info", "Pick a customer and describe the issue.");
      return;
    }
    setSubmitting(true);
    try {
      await create.mutateAsync({
        data: { kind, customerId, summary: summary.trim(), equipmentId: equipmentId ?? undefined },
      });
      Alert.alert("Ticket opened", "It's in the service queue.", [
        { text: "OK", onPress: () => router.replace("/service" as never) },
      ]);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      const msg = e instanceof Error ? e.message : "";
      if (status === 403 || /requires one of/i.test(msg)) {
        Alert.alert(
          "No permission",
          "Your account can't open service tickets. Ask a manager to open one for you.",
        );
      } else {
        Alert.alert("Could not open ticket", msg || "Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12,
    },
    title: { fontSize: 18, fontWeight: "700", color: colors.foreground, flex: 1 },
    section: { paddingHorizontal: 16, paddingTop: 16 },
    sectionTitle: { fontSize: 13, fontWeight: "600", color: colors.mutedForeground, textTransform: "uppercase", marginBottom: 8 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.foreground, backgroundColor: colors.background },
    pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    pill: { backgroundColor: colors.muted, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
    pillActive: { backgroundColor: colors.primary },
    pillText: { color: colors.foreground, fontSize: 13 },
    pillTextActive: { color: colors.primaryForeground, fontSize: 13, fontWeight: "600" },
    optionRow: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
    btn: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: "center" },
    btnText: { color: colors.primaryForeground, fontWeight: "700", fontSize: 15 },
    bodyText: { color: colors.foreground, fontSize: 14 },
  });

  const selectedCustomer = customers?.find((c) => c.id === customerId);

  return (
    <View style={styles.container}>
      <OfflineBanner />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={styles.title}>New ticket</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kind</Text>
          <View style={styles.pillRow}>
            <Pressable style={[styles.pill, kind === "service_job" && styles.pillActive]} onPress={() => setKind("service_job")}>
              <Text style={kind === "service_job" ? styles.pillTextActive : styles.pillText}>Service</Text>
            </Pressable>
            <Pressable style={[styles.pill, kind === "install_job" && styles.pillActive]} onPress={() => setKind("install_job")}>
              <Text style={kind === "install_job" ? styles.pillTextActive : styles.pillText}>Install</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <View style={styles.card}>
            {selectedCustomer ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={styles.bodyText}>{selectedCustomer.name}</Text>
                <Pressable onPress={() => { setCustomerId(undefined); setEquipmentId(undefined); }}>
                  <Text style={{ color: colors.primary, fontSize: 13 }}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  placeholder="Search customers…"
                  value={customerFilter}
                  onChangeText={setCustomerFilter}
                  style={styles.input}
                  placeholderTextColor={colors.mutedForeground}
                  testID="input-customer-search"
                />
                <View style={{ marginTop: 8 }}>
                  {filteredCustomers.map((c) => (
                    <Pressable key={c.id} style={styles.optionRow} onPress={() => setCustomerId(c.id)} testID={`pick-customer-${c.id}`}>
                      <Text style={styles.bodyText}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>

        {customerId && equipment && equipment.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Equipment (optional)</Text>
            <View style={styles.card}>
              <View style={styles.pillRow}>
                <Pressable
                  style={[styles.pill, equipmentId === undefined && styles.pillActive]}
                  onPress={() => setEquipmentId(undefined)}
                >
                  <Text style={equipmentId === undefined ? styles.pillTextActive : styles.pillText}>None</Text>
                </Pressable>
                {equipment.map((e) => (
                  <Pressable
                    key={e.id}
                    style={[styles.pill, equipmentId === e.id && styles.pillActive]}
                    onPress={() => setEquipmentId(e.id)}
                  >
                    <Text style={equipmentId === e.id ? styles.pillTextActive : styles.pillText}>
                      {[e.kind, e.manufacturer, e.model].filter(Boolean).join(" ").slice(0, 30) || "Equipment"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What's wrong?</Text>
          <View style={styles.card}>
            <TextInput
              placeholder="Describe the issue…"
              value={summary}
              onChangeText={setSummary}
              multiline
              style={[styles.input, { minHeight: 90 }]}
              placeholderTextColor={colors.mutedForeground}
              testID="input-summary"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Pressable
            style={[styles.btn, { opacity: submitting || !customerId || !summary.trim() ? 0.5 : 1 }]}
            onPress={onSubmit}
            disabled={submitting || !customerId || !summary.trim()}
            testID="btn-submit"
          >
            <Text style={styles.btnText}>{submitting ? "Opening…" : "Open ticket"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

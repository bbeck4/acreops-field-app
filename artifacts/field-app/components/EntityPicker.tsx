import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListCustomersQueryKey,
  getListProjectsQueryKey,
  getListProspectsQueryKey,
  useListCustomers,
  useListProjects,
  useListProspects,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

export type PickedEntityType = "customer" | "prospect" | "project";

export type PickedEntity = {
  entityType: PickedEntityType;
  id: number;
  name: string;
  subtitle?: string | null;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (entity: PickedEntity) => void;
  title?: string;
  /** Which entity kinds to offer. Defaults to customer + prospect. */
  entityTypes?: PickedEntityType[];
}

function getTagStyle(type: PickedEntityType, colors: ReturnType<typeof useColors>) {
  switch (type) {
    case "prospect": return { bg: colors.warningBackground, fg: colors.warning };
    case "project": return { bg: colors.secondary, fg: colors.secondaryForeground };
    case "customer": return { bg: "transparent", fg: "transparent" };
    default: return { bg: "transparent", fg: "transparent" };
  }
}

export function EntityPicker({
  visible,
  onClose,
  onSelect,
  title = "Select customer or prospect",
  entityTypes = ["customer", "prospect"],
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const wantCustomers = entityTypes.includes("customer");
  const wantProspects = entityTypes.includes("prospect");
  const wantProjects = entityTypes.includes("project");

  const { data: customers, isLoading: loadingCustomers } = useListCustomers(
    { search: search || undefined },
    { query: { queryKey: getListCustomersQueryKey({ search: search || undefined }), enabled: visible && wantCustomers } },
  );
  const { data: prospects, isLoading: loadingProspects } = useListProspects(
    { search: search || undefined },
    { query: { queryKey: getListProspectsQueryKey({ search: search || undefined }), enabled: visible && wantProspects } },
  );
  const { data: projects, isLoading: loadingProjects } = useListProjects(
    undefined,
    {
      query: {
        queryKey: getListProjectsQueryKey(),
        enabled: visible && wantProjects,
      },
    },
  );

  const items = useMemo<PickedEntity[]>(() => {
    const out: PickedEntity[] = [];
    if (wantCustomers) {
      for (const cust of customers ?? []) {
        out.push({
          entityType: "customer",
          id: cust.id,
          name: cust.name,
          subtitle: [cust.city, cust.state].filter(Boolean).join(", ") || null,
        });
      }
    }
    if (wantProspects) {
      for (const pros of prospects ?? []) {
        out.push({
          entityType: "prospect",
          id: pros.id,
          name: pros.businessName,
          subtitle: [pros.city, pros.state].filter(Boolean).join(", ") || null,
        });
      }
    }
    if (wantProjects) {
      const q = search.trim().toLowerCase();
      for (const proj of projects ?? []) {
        if (q && !proj.name.toLowerCase().includes(q)) continue;
        out.push({
          entityType: "project",
          id: proj.id,
          name: proj.name,
          subtitle: proj.status || null,
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, prospects, projects, wantCustomers, wantProspects, wantProjects, search]);

  const isLoading = loadingCustomers || loadingProspects || loadingProjects;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search…"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
            />
            {search ? (
              <Pressable onPress={() => setSearch("")}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {isLoading && items.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.entityType}-${item.id}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  {search ? "No matches found" : "No customers or prospects"}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, { borderBottomColor: colors.border }]}
                onPress={() => {
                  onSelect(item);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.subtitle ? (
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={[
                    styles.tag,
                    item.entityType === "customer"
                      ? { backgroundColor: colors.accent }
                      : { backgroundColor: getTagStyle(item.entityType, colors).bg },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      {
                        color:
                          item.entityType === "customer"
                            ? colors.primary
                            : getTagStyle(item.entityType, colors).fg,
                      },
                    ]}
                  >
                    {item.entityType === "prospect"
                      ? "Prospect"
                      : item.entityType === "project"
                        ? "Project"
                        : "Customer"}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  center: { paddingVertical: 48, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rowSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

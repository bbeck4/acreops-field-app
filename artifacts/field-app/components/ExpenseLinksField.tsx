import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ExpenseLink, ExpenseLinkInput } from "@workspace/api-client-react";

import { EntityPicker, type PickedEntityType } from "@/components/EntityPicker";
import { useColors } from "@/hooks/useColors";

export interface LinkDraft {
  key: string;
  entityType: PickedEntityType;
  id: number;
  name: string;
}

let draftSeq = 0;
function nextKey(): string {
  draftSeq += 1;
  return `lnk-${draftSeq}`;
}

/** Convert resolved links from the API into editable drafts. */
export function linksToDrafts(links: ExpenseLink[] | undefined): LinkDraft[] {
  if (!links) return [];
  const out: LinkDraft[] = [];
  for (const l of links) {
    if (l.customerId != null) {
      out.push({ key: nextKey(), entityType: "customer", id: l.customerId, name: l.customerName ?? "Customer" });
    } else if (l.prospectId != null) {
      out.push({ key: nextKey(), entityType: "prospect", id: l.prospectId, name: l.prospectName ?? "Prospect" });
    } else if (l.projectId != null) {
      out.push({ key: nextKey(), entityType: "project", id: l.projectId, name: l.projectName ?? "Project" });
    }
  }
  return out;
}

/** Convert editable drafts into the API input shape (exactly one target per link). */
export function draftsToInputs(drafts: LinkDraft[]): ExpenseLinkInput[] {
  return drafts.map((d) => {
    if (d.entityType === "customer") return { customerId: d.id };
    if (d.entityType === "prospect") return { prospectId: d.id };
    return { projectId: d.id };
  });
}

function entityLabel(entityType: PickedEntityType): string {
  if (entityType === "prospect") return "Prospect";
  if (entityType === "project") return "Project";
  return "Customer";
}

interface Props {
  value: LinkDraft[];
  onChange: (next: LinkDraft[]) => void;
  /** Picker title shown when adding a link. */
  pickerTitle?: string;
  /** Smaller "Add link" affordance for use inside report line cards. */
  compact?: boolean;
}

/**
 * Multi-link editor backed by the shared EntityPicker. Supports linking
 * customers, prospects, and projects — never assume customer-only.
 */
export function ExpenseLinksField({ value, onChange, pickerTitle = "Add a link", compact }: Props) {
  const colors = useColors();
  const [pickerOpen, setPickerOpen] = useState(false);

  const add = (entityType: PickedEntityType, id: number, name: string) => {
    setPickerOpen(false);
    if (value.some((v) => v.entityType === entityType && v.id === id)) return;
    onChange([...value, { key: nextKey(), entityType, id, name }]);
  };

  const remove = (key: string) => onChange(value.filter((v) => v.key !== key));

  return (
    <View style={styles.wrap}>
      {value.length > 0 ? (
        <View style={styles.chips}>
          {value.map((v) => (
            <View
              key={v.key}
              style={[styles.chip, { backgroundColor: colors.accent, borderColor: colors.border }]}
            >
              <Feather
                name={
                  v.entityType === "prospect"
                    ? "trending-up"
                    : v.entityType === "project"
                      ? "folder"
                      : "home"
                }
                size={11}
                color={colors.accentForeground}
              />
              <Text style={[styles.chipText, { color: colors.accentForeground }]} numberOfLines={1}>
                {v.name}
              </Text>
              <Pressable onPress={() => remove(v.key)} hitSlop={8} accessibilityLabel={`Remove ${v.name}`}>
                <Feather name="x" size={13} color={colors.accentForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        style={[
          styles.addBtn,
          compact ? styles.addBtnCompact : null,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
        onPress={() => setPickerOpen(true)}
      >
        <Feather name="link" size={14} color={colors.primary} />
        <Text style={[styles.addBtnText, { color: colors.primary }]}>Add link</Text>
      </Pressable>

      <EntityPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={pickerTitle}
        entityTypes={["customer", "prospect", "project"]}
        onSelect={(entity) => add(entity.entityType, entity.id, entity.name)}
      />
    </View>
  );
}

export { entityLabel };

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 5,
    maxWidth: "100%",
  },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 1 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
  },
  addBtnCompact: { paddingVertical: 9, paddingHorizontal: 12 },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

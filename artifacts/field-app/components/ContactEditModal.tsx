import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  Contact,
  getListCustomerContactsQueryKey,
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

type Props = {
  visible: boolean;
  customerId: number;
  contact: Contact | null;
  onClose: () => void;
};

export function ContactEditModal({ visible, customerId, contact, onClose }: Props) {
  const colors = useColors();
  const qc = useQueryClient();
  const isEdit = contact != null;

  const { mutateAsync: createContact, isPending: isCreating } = useCreateContact();
  const { mutateAsync: updateContact, isPending: isUpdating } = useUpdateContact();
  const { mutateAsync: deleteContact, isPending: isDeleting } = useDeleteContact();
  const isPending = isCreating || isUpdating || isDeleting;

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (visible) {
      setName(contact?.name ?? "");
      setTitle(contact?.title ?? "");
      setEmail(contact?.email ?? "");
      setPhone(contact?.phone ?? "");
    }
    // Only reset on open / when a different contact is opened — not when
    // the contact object is refetched mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, contact?.id]);

  const canSubmit = name.trim().length > 0 && !isPending;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListCustomerContactsQueryKey(customerId) });

  const submit = async () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const trimmedTitle = title.trim();
      const trimmedEmail = email.trim();
      const trimmedPhone = phone.trim();
      if (isEdit && contact) {
        // In edit mode, send "" for cleared fields so the server can wipe them;
        // omitting (undefined) would leave the previous value untouched.
        await updateContact({
          id: contact.id,
          data: {
            name: name.trim(),
            title: trimmedTitle,
            email: trimmedEmail,
            phone: trimmedPhone,
          },
        });
      } else {
        await createContact({
          data: {
            customerId,
            name: name.trim(),
            title: trimmedTitle || undefined,
            email: trimmedEmail || undefined,
            phone: trimmedPhone || undefined,
          },
        });
      }
      await invalidate();
      onClose();
    } catch (e) {
      Alert.alert("Error", `Couldn't save contact: ${(e as Error).message}`);
    }
  };

  const remove = () => {
    if (!contact) return;
    Alert.alert("Delete contact?", `Remove ${contact.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteContact({ id: contact.id });
            await invalidate();
            onClose();
          } catch (e) {
            Alert.alert("Error", `Couldn't delete contact: ${(e as Error).message}`);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={8} testID="contact-cancel">
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>
                Cancel
              </Text>
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {isEdit ? "Edit Contact" : "New Contact"}
            </Text>
            <Pressable onPress={submit} hitSlop={8} disabled={!canSubmit} testID="contact-save">
              {isCreating || isUpdating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={{
                    color: canSubmit ? colors.primary : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Field label="Name *" colors={colors}>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                testID="contact-name"
              />
            </Field>
            <Field label="Title" colors={colors}>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Farm Manager"
                placeholderTextColor={colors.mutedForeground}
                testID="contact-title"
              />
            </Field>
            <Field label="Phone" colors={colors}>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                value={phone}
                onChangeText={setPhone}
                placeholder="(555) 555-1234"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                testID="contact-phone"
              />
            </Field>
            <Field label="Email" colors={colors}>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="contact-email"
              />
            </Field>

            {isEdit ? (
              <Pressable
                onPress={remove}
                style={[styles.deleteBtn, { borderColor: colors.border }]}
                disabled={isPending}
                testID="contact-delete"
              >
                <Feather name="trash-2" size={16} color={colors.destructive} />
                <Text style={{ color: colors.destructive, fontFamily: "Inter_600SemiBold" }}>
                  {isDeleting ? "Deleting…" : "Delete contact"}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "90%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 8,
  },
});

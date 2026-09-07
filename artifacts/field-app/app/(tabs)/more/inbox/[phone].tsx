import React, { useState, useEffect, useRef } from "react";
import { 
  View, 
  Text, 
  StyleSheet, 
  Pressable, 
  TextInput, 
  FlatList, 
  ActivityIndicator,
  Platform
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { useColors } from "@/hooks/useColors";
import { 
  useGetSmsInboxConversation, 
  useReplyToSmsInboxConversation,
  useUpdateSmsInboxConversation,
  useGetSmsConsent,
  getGetSmsInboxConversationQueryKey,
  getGetSmsConsentQueryKey,
  useListMembers,
  getListMembersQueryKey
} from "@workspace/api-client-react";
import { useAppAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/EmptyState";
import { useQueryClient } from "@tanstack/react-query";

import { usePermissions } from "@/lib/permissions";

export default function InboxConversationScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const decodedPhone = decodeURIComponent(phone ?? "");
  
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { currentMember } = useAppAuth();
  const queryClient = useQueryClient();
  const { has } = usePermissions();

  const canEdit = has("sms.edit");

  const [replyBody, setReplyBody] = useState("");
  const [program, setProgram] = useState<"updates" | "join">("updates");
  const [pendingNotice, setPendingNotice] = useState<{ keyword: string, status: string } | null>(null);
  const [showAssignMenu, setShowAssignMenu] = useState(false);

  const { data: conversation, isLoading, isError, refetch } = useGetSmsInboxConversation(decodedPhone);
  const { data: consent } = useGetSmsConsent({ phone: decodedPhone }, { query: { enabled: !!decodedPhone, queryKey: getGetSmsConsentQueryKey({ phone: decodedPhone }) } });
  const { data: members = [] } = useListMembers({}, { query: { enabled: showAssignMenu, queryKey: getListMembersQueryKey({}) } });

  const replyMutation = useReplyToSmsInboxConversation();
  const updateMutation = useUpdateSmsInboxConversation();

  // Mark as read when entering or when conversation updates with unread messages
  useEffect(() => {
    if (conversation && !conversation.isRead && canEdit) {
      updateMutation.mutate(
        { phone: decodedPhone, data: { isRead: true } },
        {
          onSuccess: () => {
            queryClient.setQueryData(getGetSmsInboxConversationQueryKey(decodedPhone), (old: any) => {
              if (!old) return old;
              return { ...old, isRead: true, unreadCount: 0 };
            });
          }
        }
      );
    }
  }, [conversation?.isRead, decodedPhone, updateMutation, queryClient]);

  const handleSend = () => {
    if (!replyBody.trim()) return;
    setPendingNotice(null);
    
    replyMutation.mutate(
      { 
        phone: decodedPhone, 
        data: { 
          body: replyBody.trim(), 
          program
        } 
      },
      {
        onSuccess: (res) => {
          setReplyBody("");
          if ("status" in res && res.status === "pending_consent") {
            setPendingNotice({ keyword: res.requiredKeyword, status: res.emailNoticeStatus });
          }
          // Optimistically or by refetch. Refetching is safer.
          refetch();
        }
      }
    );
  };

  const assignTo = (memberId: number | null) => {
    updateMutation.mutate(
      { phone: decodedPhone, data: { assignedMemberId: memberId } },
      {
        onSuccess: () => {
          setShowAssignMenu(false);
          queryClient.setQueryData(getGetSmsInboxConversationQueryKey(decodedPhone), (old: any) => {
            if (!old) return old;
            return { ...old, assignedMemberId: memberId };
          });
        }
      }
    );
  };

  const isGloballySuppressed = consent?.globallySuppressed ?? false;

  const getEmailNoticeText = (status: string) => {
    switch (status) {
      case "sent": return "An email notice was sent.";
      case "pending":
      case "sending": return "An email notice is being sent.";
      case "failed_retryable":
      case "failed_unknown": return "Email notice failed to send. Please contact the recipient another way.";
      case "not_applicable": return "No eligible email found. Please contact the recipient another way.";
      default: return "No eligible email found.";
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Pressable 
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={8}
          >
            <Feather name="chevron-left" size={28} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerTitleContainer}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>{decodedPhone}</Text>
            {conversation?.assignedMemberId && (
              <Text style={[styles.assignedText, { color: colors.mutedForeground }]}>
                Assigned to {members.find(m => m.id === conversation.assignedMemberId)?.name ?? "Member"}
              </Text>
            )}
          </View>
          <View style={styles.headerActions}>
            {conversation?.customerId && (
              <Pressable 
                onPress={() => router.push(`/customer/${conversation.customerId}` as never)}
                style={styles.actionButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="View CRM Profile"
              >
                <Feather name="user" size={20} color={colors.primary} />
              </Pressable>
            )}
            {canEdit && (
              <Pressable 
                onPress={() => setShowAssignMenu(!showAssignMenu)}
                style={styles.actionButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Assign conversation"
              >
                <Feather name="user-check" size={20} color={colors.foreground} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {showAssignMenu && (
        <View style={[styles.assignMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.assignMenuTitle, { color: colors.foreground }]}>Assign Conversation</Text>
          <FlatList
            data={[{ id: null, name: "Unassigned" }, ...members]}
            keyExtractor={m => String(m.id)}
            style={{ maxHeight: 200 }}
            renderItem={({ item }) => (
              <Pressable 
                style={[styles.assignMenuItem, { borderBottomColor: colors.border }]}
                onPress={() => assignTo(item.id)}
              >
                <Text style={[styles.assignMenuText, { color: colors.foreground }]}>
                  {item.name}
                </Text>
                {conversation?.assignedMemberId === item.id && (
                  <Feather name="check" size={16} color={colors.primary} />
                )}
              </Pressable>
            )}
          />
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError || !conversation ? (
        <View style={styles.centerContainer}>
          <EmptyState
            icon="alert-circle"
            title="Failed to load"
            subtitle="Could not load conversation."
          />
        </View>
      ) : (
        <>
          <FlatList
            data={[...(conversation.messages ?? [])].reverse()}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={[styles.listContent]}
            inverted
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isOutbound = item.direction === "outbound";
              return (
                <View style={[
                  styles.messageBubble,
                  isOutbound ? styles.messageOutbound : styles.messageInbound,
                  { backgroundColor: isOutbound ? colors.primary : colors.muted }
                ]}>
                  <Text style={[
                    styles.messageText,
                    { color: isOutbound ? colors.primaryForeground : colors.foreground }
                  ]}>
                    {item.body}
                  </Text>
                  <Text style={[
                    styles.messageStatus,
                    { color: isOutbound ? "rgba(255,255,255,0.7)" : colors.mutedForeground }
                  ]}>
                    {item.status}
                  </Text>
                </View>
              );
            }}
          />
          
          <View style={[
            styles.composer, 
            { 
              backgroundColor: colors.card, 
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12)
            }
          ]}>
            {!canEdit ? (
              <View style={[styles.noConsentBanner, { backgroundColor: colors.muted }]}>
                <Text style={[styles.noConsentText, { color: colors.mutedForeground }]}>
                  You do not have permission to reply.
                </Text>
              </View>
            ) : isGloballySuppressed ? (
              <View style={[styles.noConsentBanner, { backgroundColor: colors.destructive }]}>
                <Text style={[styles.noConsentText, { color: colors.destructiveForeground }]}>
                  Customer has opted out of all SMS (STOP).
                </Text>
              </View>
            ) : (
              <>
                {pendingNotice && (
                  <View style={[styles.pendingBanner, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                    <Text style={[styles.pendingText, { color: colors.foreground }]}>
                      Message held for consent. {getEmailNoticeText(pendingNotice.status)} They must reply {pendingNotice.keyword}.
                    </Text>
                    <Pressable onPress={() => setPendingNotice(null)} style={{ padding: 4 }} hitSlop={8}>
                      <Feather name="x" size={16} color={colors.foreground} />
                    </Pressable>
                  </View>
                )}
                <View style={styles.programToggle}>
                  <Pressable 
                    style={[styles.programBtn, program === "updates" ? { backgroundColor: colors.primary } : { backgroundColor: colors.muted }]}
                    onPress={() => setProgram("updates")}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.programBtnText, { color: program === "updates" ? colors.primaryForeground : colors.foreground }]}>Marketing</Text>
                  </Pressable>
                  <Pressable 
                    style={[styles.programBtn, program === "join" ? { backgroundColor: colors.primary } : { backgroundColor: colors.muted }]}
                    onPress={() => setProgram("join")}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.programBtnText, { color: program === "join" ? colors.primaryForeground : colors.foreground }]}>Operational</Text>
                  </Pressable>
                </View>
                <View style={[styles.inputRow, { backgroundColor: colors.background }]}>
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="Type a message..."
                  placeholderTextColor={colors.mutedForeground}
                  value={replyBody}
                  onChangeText={setReplyBody}
                  multiline
                  maxLength={1000}
                />
                <Pressable
                  style={[
                    styles.sendButton,
                    { backgroundColor: replyBody.trim() ? colors.primary : colors.muted }
                  ]}
                  onPress={handleSend}
                  disabled={!replyBody.trim() || replyMutation.isPending}
                >
                  {replyMutation.isPending ? (
                    <ActivityIndicator size="small" color={replyBody.trim() ? colors.primaryForeground : colors.mutedForeground} />
                  ) : (
                    <Feather 
                      name="send" 
                      size={18} 
                      color={replyBody.trim() ? colors.primaryForeground : colors.mutedForeground} 
                    />
                  )}
                </Pressable>
              </View>
              </>
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, zIndex: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, height: 56 },
  backButton: { padding: 8, marginRight: 8 },
  headerTitleContainer: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  assignedText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 16, paddingRight: 8 },
  actionButton: { padding: 4 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  listContent: { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  messageBubble: {
    maxWidth: "80%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  messageInbound: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  messageOutbound: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  messageText: { fontSize: 16, fontFamily: "Inter_400Regular", lineHeight: 22 },
  messageStatus: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4, alignSelf: "flex-end", textTransform: "capitalize" },
  composer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  noConsentBanner: {
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  noConsentText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    gap: 8,
  },
  pendingText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  programToggle: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  programBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  programBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  assignMenu: {
    position: "absolute",
    top: 100, // Roughly below header
    right: 16,
    width: 250,
    borderWidth: 1,
    borderRadius: 8,
    zIndex: 20,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  assignMenuTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ccc",
  },
  assignMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  assignMenuText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});

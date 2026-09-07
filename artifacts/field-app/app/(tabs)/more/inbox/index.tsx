import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useListSmsInboxConversations } from "@workspace/api-client-react";
import { useAppAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/EmptyState";

type FilterMode = "all" | "unread" | "mine";

export default function InboxListScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { currentMember } = useAppAuth();
  
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const queryParams = useMemo(() => {
    return {
      unread: filterMode === "unread" ? true : undefined,
      assignedMemberId: filterMode === "mine" ? currentMember?.id : undefined,
    };
  }, [filterMode, currentMember?.id]);

  const { data: conversations, isLoading, isError, refetch } = useListSmsInboxConversations(queryParams);

  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    if (!searchQuery.trim()) return conversations;
    
    const query = searchQuery.toLowerCase();
    return conversations.filter(c => 
      c.phone.toLowerCase().includes(query) || 
      c.latestMessage?.body?.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Pressable 
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="chevron-left" size={28} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Inbox</Text>
        </View>

        <View style={styles.searchRow}>
          <View style={[styles.searchBox, { backgroundColor: colors.muted }]}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search conversations..."
              placeholderTextColor={colors.mutedForeground}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Feather name="x-circle" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.filterRow}>
          {(["all", "unread", "mine"] as FilterMode[]).map(mode => {
            const isActive = filterMode === mode;
            return (
              <Pressable
                key={mode}
                style={[
                  styles.filterChip,
                  { backgroundColor: isActive ? colors.primary : colors.muted },
                ]}
                onPress={() => setFilterMode(mode)}
                accessibilityRole="button"
              >
                <Text style={[
                  styles.filterLabel,
                  { color: isActive ? colors.primaryForeground : colors.foreground }
                ]}>
                  {mode === "all" ? "All" : mode === "unread" ? "Unread" : "Assigned to me"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <EmptyState
            icon="alert-circle"
            title="Failed to load inbox"
            subtitle="Could not load conversations. Please try again."
          />
        </View>
      ) : filteredConversations.length === 0 ? (
        <View style={styles.centerContainer}>
          <EmptyState
            icon="message-square"
            title="No conversations"
            subtitle={searchQuery ? "No conversations match your search." : "You're all caught up."}
          />
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={item => item.phone}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          refreshing={isLoading}
          onRefresh={refetch}
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const isUnread = !item.isRead;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.conversationItem,
                  { backgroundColor: pressed ? colors.muted : colors.card, borderBottomColor: colors.border }
                ]}
                onPress={() => router.push(`/more/inbox/${encodeURIComponent(item.phone)}`)}
              >
                <View style={styles.itemHeader}>
                  <Text style={[styles.phoneText, { color: colors.foreground, fontFamily: isUnread ? "Inter_700Bold" : "Inter_600SemiBold" }]}>
                    {item.phone}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={[styles.unreadBadge, { backgroundColor: colors.destructive }]}>
                      <Text style={[styles.unreadBadgeText, { color: colors.destructiveForeground }]}>
                        {item.unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
                
                <View style={styles.messageRow}>
                  {isUnread && item.unreadCount === 0 && (
                    <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
                  )}
                  <Text 
                    style={[styles.messagePreview, { color: isUnread ? colors.foreground : colors.mutedForeground, fontFamily: isUnread ? "Inter_500Medium" : "Inter_400Regular" }]}
                    numberOfLines={2}
                  >
                    {item.latestMessage?.body ?? "No messages"}
                  </Text>
                </View>
                
                {(item.customerId || item.assignedMemberId) && (
                  <View style={styles.badgesRow}>
                    {item.customerId && (
                      <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                        <Feather name="user" size={12} color={colors.primary} />
                        <Text style={[styles.badgeText, { color: colors.primary }]}>CRM Profile</Text>
                      </View>
                    )}
                    {item.assignedMemberId && (
                      <View style={[styles.badge, { backgroundColor: colors.muted }]}>
                        <Feather name="check-circle" size={12} color={colors.foreground} />
                        <Text style={[styles.badgeText, { color: colors.foreground }]}>Assigned</Text>
                      </View>
                    )}
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingBottom: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, height: 56 },
  backButton: { padding: 8, marginRight: 8 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  searchRow: { paddingHorizontal: 16, marginTop: 8 },
  searchBox: { 
    flexDirection: "row", 
    alignItems: "center", 
    borderRadius: 8, 
    paddingHorizontal: 12, 
    height: 40 
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16, fontFamily: "Inter_400Regular" },
  filterRow: { 
    flexDirection: "row", 
    paddingHorizontal: 16, 
    marginTop: 12, 
    gap: 8 
  },
  filterChip: { 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16 
  },
  filterLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  listContent: { },
  conversationItem: { 
    padding: 16, 
    borderBottomWidth: StyleSheet.hairlineWidth 
  },
  itemHeader: { 
    flexDirection: "row", 
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  },
  phoneText: { fontSize: 16 },
  unreadBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  messageRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 2 },
  messagePreview: { flex: 1, fontSize: 14, lineHeight: 20 },
  badgesRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  badge: { 
    flexDirection: "row", 
    alignItems: "center", 
    paddingHorizontal: 8, 
    paddingVertical: 4, 
    borderRadius: 4, 
    gap: 4 
  },
  badgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

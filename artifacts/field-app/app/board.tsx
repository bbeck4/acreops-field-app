import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetRecentBoardPostsQueryKey,
  getListMessagesQueryKey,
  useCreateMessage,
  useDeleteMessage,
  useListCustomers,
  useGetRecentBoardPosts,
  useListMembers,
  useListMessages,
  useMarkBoardSeen,
  useUpdateMessage,
} from "@workspace/api-client-react";
import type { Message } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { MOOD_OPTIONS, splitMood, withMood } from "@/lib/mood";

const COLOR_OPTIONS = [
  { value: "yellow", color: "#ca8a04", bg: "#fef9c3" },
  { value: "green", color: "#16a34a", bg: "#dcfce7" },
  { value: "blue", color: "#2563eb", bg: "#dbeafe" },
  { value: "pink", color: "#db2777", bg: "#fce7f3" },
  { value: "orange", color: "#ea580c", bg: "#ffedd5" },
];

const COLOR_BARS: Record<string, string> = Object.fromEntries(
  COLOR_OPTIONS.map((c) => [c.value, c.color]),
);

const COLOR_BGS: Record<string, string> = Object.fromEntries(
  COLOR_OPTIONS.map((c) => [c.value, c.bg]),
);

// Board background themes, persisted per-device in AsyncStorage so each rep can
// give the board its own personality. `bg`/`muted` of null mean "use the active
// palette" (so the Plain theme adapts to light/dark mode); the textured themes
// pin intrinsic colors that read the same in both schemes.
const BOARD_THEME_KEY = "board_bg_theme_v1";

type BoardThemeDef = {
  value: string;
  label: string;
  swatch: string;
  bg: string | null;
  muted: string | null;
  border: string | null;
};

const BOARD_THEMES: BoardThemeDef[] = [
  { value: "linen", label: "Linen", swatch: "#efe3c8", bg: "#f5efe0", muted: "#8a7c5c", border: "#e5d9bd" },
  { value: "cork", label: "Cork", swatch: "#c8a06a", bg: "#c8a06a", muted: "rgba(60,38,12,0.7)", border: "#a67c46" },
  { value: "chalkboard", label: "Chalkboard", swatch: "#2b3a34", bg: "#2b3a34", muted: "rgba(236,240,235,0.78)", border: "#1f2a26" },
  { value: "plain", label: "Plain", swatch: "#9ca3af", bg: null, muted: null, border: null },
];

function getBoardThemeDef(value: string): BoardThemeDef {
  return BOARD_THEMES.find((t) => t.value === value) ?? BOARD_THEMES[0];
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Per-thread "last expanded" timestamps (ISO strings keyed by parent id).
// Persisted on-device so each rep tracks their own per-thread read state
// independently. The key is namespaced so it doesn't collide with other
// caches on the device.
const THREAD_SEEN_KEY = "board_thread_seen_v1";

async function readThreadSeenMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(THREAD_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeThreadSeenMap(map: Record<string, string>) {
  AsyncStorage.setItem(THREAD_SEEN_KEY, JSON.stringify(map)).catch(() => {});
}

function countNewReplies(
  message: Message,
  seenAt: string | null,
  fallbackSeenAt: string | null,
  currentMemberId: number | undefined,
): number {
  const replies = message.replies ?? [];
  if (!replies.length) return 0;
  const baseline = seenAt ?? fallbackSeenAt;
  const baselineMs = baseline ? new Date(baseline).getTime() : null;
  return replies.filter((r) => {
    if (currentMemberId != null && r.authorId === currentMemberId) return false;
    if (baselineMs == null) return true;
    return new Date(r.createdAt).getTime() > baselineMs;
  }).length;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function BoardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentMember } = useAppAuth();
  const queryClient = useQueryClient();

  const {
    data: posts,
    isLoading,
    refetch,
    isRefetching,
  } = useListMessages();

  const markBoardSeen = useMarkBoardSeen();
  const updateMessage = useUpdateMessage();
  const deleteMessage = useDeleteMessage();
  // Snapshot the server-side last-seen timestamp at first render so it stays
  // stable as a fallback baseline even after we call mark-board-seen below.
  const { data: recentBoardData } = useGetRecentBoardPosts();
  const fallbackSeenAtRef = useRef<string | null>(null);
  if (fallbackSeenAtRef.current == null && recentBoardData?.lastSeenAt) {
    fallbackSeenAtRef.current = new Date(recentBoardData.lastSeenAt).toISOString();
  }

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Message | null>(null);
  const [replyingToPost, setReplyingToPost] = useState<Message | null>(null);
  const [boardThemeValue, setBoardThemeValue] = useState<string>("linen");
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [busyPostId, setBusyPostId] = useState<number | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Record<number, boolean>>({});
  const [threadSeenMap, setThreadSeenMap] = useState<Record<string, string>>({});
  // Snapshot of the prior seen timestamp at the moment a thread is opened,
  // used to highlight individual replies that arrived since the rep last
  // viewed it. Memory-only — resets each time the thread is reopened.
  const [expandBaselineMap, setExpandBaselineMap] = useState<
    Record<number, string | null>
  >({});

  // Hydrate the per-thread seen map from on-device storage once on mount.
  useEffect(() => {
    let cancelled = false;
    readThreadSeenMap().then((map) => {
      if (!cancelled) setThreadSeenMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate the saved board background theme once on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(BOARD_THEME_KEY)
      .then((v) => {
        if (!cancelled && v && BOARD_THEMES.some((t) => t.value === v)) {
          setBoardThemeValue(v);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBoardTheme = (value: string) => {
    setBoardThemeValue(value);
    setThemePickerOpen(false);
    AsyncStorage.setItem(BOARD_THEME_KEY, value).catch(() => {});
  };

  const boardTheme = getBoardThemeDef(boardThemeValue);
  const boardBg = boardTheme.bg ?? colors.background;
  const boardMuted = boardTheme.muted ?? colors.mutedForeground;

  const markThreadSeen = (id: number) => {
    setThreadSeenMap((prev) => {
      const next = { ...prev, [String(id)]: new Date().toISOString() };
      writeThreadSeenMap(next);
      return next;
    });
  };

  // Snapshot the prior seen timestamp BEFORE markThreadSeen overwrites it so
  // the expanded view can highlight replies newer than it.
  const captureExpandBaseline = (id: number) => {
    const prior =
      threadSeenMap[String(id)] ?? fallbackSeenAtRef.current ?? null;
    setExpandBaselineMap((prev) => ({ ...prev, [id]: prior }));
  };

  // Deep-link support: when opened from a "X replied to your post" push, the
  // thread query param tells us which root post to auto-expand.
  const { thread } = useLocalSearchParams<{ thread?: string | string[] }>();
  const threadParam = Array.isArray(thread) ? thread[0] : thread;
  const threadIdToOpen = (() => {
    const n = threadParam ? Number(threadParam) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const lastOpenedThreadId = useRef<number | null>(null);

  useEffect(() => {
    if (threadIdToOpen == null) return;
    if (lastOpenedThreadId.current === threadIdToOpen) return;
    lastOpenedThreadId.current = threadIdToOpen;
    setExpandedThreads((prev) => {
      if (!prev[threadIdToOpen]) {
        captureExpandBaseline(threadIdToOpen);
        markThreadSeen(threadIdToOpen);
      }
      return { ...prev, [threadIdToOpen]: true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadIdToOpen]);

  // When the rep opens the board, advance the server-side last-seen timestamp
  // so the unread badge clears for them on both the field app and the web app.
  useEffect(() => {
    markBoardSeen.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetRecentBoardPostsQueryKey(),
        });
      },
    });
    // We only want to fire this once per screen open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetRecentBoardPostsQueryKey(),
    });
  };

  const togglePin = async (post: Message) => {
    setBusyPostId(post.id);
    try {
      await updateMessage.mutateAsync({
        id: post.id,
        data: { pinned: !post.pinned },
      });
      invalidateLists();
    } catch {
      Alert.alert("Error", "Could not update the post. Please try again.");
    } finally {
      setBusyPostId(null);
    }
  };

  const handleDelete = (post: Message) => {
    Alert.alert("Delete post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusyPostId(post.id);
          try {
            await deleteMessage.mutateAsync({ id: post.id });
            invalidateLists();
          } catch {
            Alert.alert("Error", "Could not delete the post. Please try again.");
          } finally {
            setBusyPostId(null);
          }
        },
      },
    ]);
  };

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  // The API only returns root messages at the top level (replies are nested
  // on the parent), so this sort applies just to threads.
  const sortedPosts = (posts ?? [])
    .slice()
    .filter((p) => p.parentMessageId == null)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const toggleThread = (id: number) =>
    setExpandedThreads((prev) => {
      const wasExpanded = !!prev[id];
      // Only mark as seen on the open transition — collapsing shouldn't
      // bump the timestamp.
      if (!wasExpanded) {
        captureExpandBaseline(id);
        markThreadSeen(id);
      }
      return { ...prev, [id]: !wasExpanded };
    });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 8,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          style={styles.headerBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)" as never);
          }}
          hitSlop={8}
        >
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>🌾 Team Board</Text>
        <Pressable
          style={styles.headerBtn}
          onPress={() => setThemePickerOpen(true)}
          hitSlop={8}
        >
          <Feather name="image" size={20} color={colors.foreground} />
        </Pressable>
        <Pressable
          style={styles.headerBtn}
          onPress={() => {
            setEditingPost(null);
            setComposerOpen(true);
          }}
          hitSlop={8}
        >
          <Feather name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        style={[styles.scroll, { backgroundColor: boardBg }]}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading ? (
          <Text style={[styles.loading, { color: boardMuted }]}>
            Loading…
          </Text>
        ) : sortedPosts.length === 0 ? (
          <EmptyState
            icon="message-square"
            title="No recent posts"
            subtitle="New team-board posts will show up here"
          />
        ) : (
          sortedPosts.map((p: Message) => (
            <PostCard
              key={p.id}
              post={p}
              currentMemberId={currentMember?.id}
              busy={busyPostId === p.id}
              expanded={!!expandedThreads[p.id]}
              newReplyCount={countNewReplies(
                p,
                threadSeenMap[String(p.id)] ?? null,
                fallbackSeenAtRef.current,
                currentMember?.id,
              )}
              expandBaseline={expandBaselineMap[p.id] ?? null}
              onToggleThread={() => toggleThread(p.id)}
              onTogglePin={() => togglePin(p)}
              onEdit={() => {
                setReplyingToPost(null);
                setEditingPost(p);
                setComposerOpen(true);
              }}
              onDelete={() => handleDelete(p)}
              onReply={() => {
                setEditingPost(null);
                setReplyingToPost(p);
                setComposerOpen(true);
                setExpandedThreads((prev) => {
                  // Replying reveals the thread; treat it the same as
                  // explicitly expanding so the unread badge clears.
                  if (!prev[p.id]) {
                    captureExpandBaseline(p.id);
                    markThreadSeen(p.id);
                  }
                  return { ...prev, [p.id]: true };
                });
              }}
              onDeleteReply={(reply) => handleDelete(reply)}
              busyReplyId={busyPostId}
            />
          ))
        )}
      </ScrollView>

      <ComposerModal
        visible={composerOpen}
        editingPost={editingPost}
        replyingToPost={replyingToPost}
        currentMemberId={currentMember?.id}
        onClose={() => {
          setComposerOpen(false);
          setEditingPost(null);
          setReplyingToPost(null);
        }}
        onSaved={() => {
          invalidateLists();
          setComposerOpen(false);
          setEditingPost(null);
          setReplyingToPost(null);
        }}
      />

      <ThemePickerSheet
        visible={themePickerOpen}
        selectedValue={boardThemeValue}
        onSelect={applyBoardTheme}
        onClose={() => setThemePickerOpen(false)}
      />
    </View>
  );
}

function PostCard({
  post,
  currentMemberId,
  busy,
  expanded,
  newReplyCount = 0,
  expandBaseline = null,
  onToggleThread,
  onTogglePin,
  onEdit,
  onDelete,
  onReply,
  onDeleteReply,
  busyReplyId,
}: {
  post: Message;
  currentMemberId?: number;
  busy: boolean;
  expanded: boolean;
  newReplyCount?: number;
  expandBaseline?: string | null;
  onToggleThread: () => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  onDeleteReply: (reply: Message) => void;
  busyReplyId: number | null;
}) {
  const colors = useColors();
  const barColor = COLOR_BARS[post.colorTag] ?? COLOR_BARS.yellow;
  const { mood: moodTag, body: contentBody } = splitMood(post.content);
  const isPrivate = post.recipientId != null;
  const isToMe = isPrivate && post.recipientId === currentMemberId;
  const isFromMe = isPrivate && post.authorId === currentMemberId;
  const isAuthor = post.authorId === currentMemberId;
  const replies = post.replies ?? [];
  const replyCount = post.replyCount ?? replies.length;

  const cardBg = COLOR_BGS[post.colorTag] ?? COLOR_BGS.yellow;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor: barColor },
      ]}
    >
      <View style={[styles.colorBar, { backgroundColor: barColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, { backgroundColor: barColor }]}>
            <Text style={[styles.avatarText, { color: "#fff" }]}>
              {getInitials(post.authorName || "?")}
            </Text>
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={[styles.author, { color: colors.foreground }]}>
              {post.authorName || "Unknown"}
              {post.pinned ? "  📌" : ""}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground, opacity: 0.7 }]}>
              {formatDate(post.createdAt)}
            </Text>
          </View>
          {isAuthor ? (
            <View style={styles.cardActions}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <>
                  {!isPrivate ? (
                    <Pressable
                      onPress={onTogglePin}
                      hitSlop={8}
                      style={styles.iconBtn}
                    >
                      <Feather
                        name={post.pinned ? "bookmark" : "plus-square"}
                        size={16}
                        color={
                          post.pinned ? "#d97706" : colors.mutedForeground
                        }
                      />
                    </Pressable>
                  ) : null}
                  <Pressable onPress={onEdit} hitSlop={8} style={styles.iconBtn}>
                    <Feather
                      name="edit-2"
                      size={15}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                  <Pressable
                    onPress={onDelete}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <Feather name="trash-2" size={15} color="#dc2626" />
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
        </View>

        {isPrivate ? (
          <View
            style={[
              styles.privateChip,
              {
                backgroundColor: colors.accent,
                borderColor: colors.border,
              },
            ]}
          >
            <Feather name="lock" size={11} color={colors.mutedForeground} />
            <Text style={[styles.privateText, { color: colors.mutedForeground }]}>
              {isToMe
                ? `Private to you`
                : isFromMe
                ? `Private to ${post.recipientName ?? "—"}`
                : `Private`}
            </Text>
          </View>
        ) : null}

        {post.customerName ? (
          <View style={styles.customerRow}>
            <Feather name="briefcase" size={12} color={colors.mutedForeground} />
            <Text style={[styles.customer, { color: colors.mutedForeground }]}>
              {post.customerName}
            </Text>
          </View>
        ) : null}

        {moodTag ? (
          <View
            style={[
              styles.moodBadge,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <Text style={styles.moodBadgeEmoji}>{moodTag.emoji}</Text>
            <Text style={[styles.moodBadgeLabel, { color: colors.foreground }]}>
              {moodTag.label}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.content_, { color: colors.foreground }]}>
          {contentBody}
        </Text>

        <View style={styles.threadFooter}>
          <Pressable onPress={onReply} hitSlop={6} style={styles.replyAction}>
            <Feather name="corner-up-left" size={13} color={colors.primary} />
            <Text style={[styles.replyActionText, { color: colors.primary }]}>
              Reply
            </Text>
          </Pressable>
          {replyCount > 0 ? (
            <Pressable
              onPress={onToggleThread}
              hitSlop={6}
              style={styles.replyAction}
            >
              <Feather
                name={expanded ? "chevron-up" : "message-circle"}
                size={13}
                color={colors.mutedForeground}
              />
              <Text
                style={[
                  styles.replyActionText,
                  { color: colors.mutedForeground },
                ]}
              >
                {expanded
                  ? `Hide ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
                  : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
              </Text>
            </Pressable>
          ) : null}
          {!expanded && newReplyCount > 0 ? (
            <View style={styles.newReplyBadge}>
              <Text style={styles.newReplyBadgeText}>{newReplyCount} new</Text>
            </View>
          ) : null}
        </View>

        {!expanded && replyCount > 0 && post.lastReplyPreview ? (
          <View
            style={[
              styles.lastReplyPreview,
              { borderColor: colors.border, backgroundColor: colors.background },
            ]}
          >
            <Text
              style={[styles.lastReplyAuthor, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {post.lastReplyAuthorName ?? "Someone"}
            </Text>
            <Text
              style={[styles.lastReplyText, { color: colors.mutedForeground }]}
              numberOfLines={2}
            >
              {post.lastReplyPreview}
            </Text>
          </View>
        ) : null}

        {expanded && replies.length > 0 ? (
          <View
            style={[styles.repliesContainer, { borderLeftColor: barColor }]}
          >
            {replies.map((reply) => {
              const replyIsAuthor = reply.authorId === currentMemberId;
              const replyBusy = busyReplyId === reply.id;
              const baselineMs = expandBaseline
                ? new Date(expandBaseline).getTime()
                : null;
              const isNewReply =
                !replyIsAuthor &&
                (baselineMs == null ||
                  new Date(reply.createdAt).getTime() > baselineMs);
              return (
                <View
                  key={reply.id}
                  style={[
                    styles.replyRow,
                    isNewReply ? styles.replyRowNew : null,
                  ]}
                >
                  <View
                    style={[
                      styles.replyAvatar,
                      { backgroundColor: barColor },
                    ]}
                  >
                    <Text
                      style={[
                        styles.replyAvatarText,
                        { color: "#fff" },
                      ]}
                    >
                      {getInitials(reply.authorName || "?")}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.replyHeaderRow}>
                      <Text
                        style={[styles.replyAuthor, { color: colors.foreground }]}
                      >
                        {reply.authorName || "Unknown"}
                      </Text>
                      <Text
                        style={[styles.replyMeta, { color: colors.mutedForeground }]}
                      >
                        {formatDate(reply.createdAt)}
                      </Text>
                      {isNewReply ? (
                        <View style={styles.replyNewPill}>
                          <Text style={styles.replyNewPillText}>NEW</Text>
                        </View>
                      ) : null}
                      {replyIsAuthor ? (
                        replyBusy ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.mutedForeground}
                          />
                        ) : (
                          <Pressable
                            onPress={() => onDeleteReply(reply)}
                            hitSlop={6}
                            style={styles.iconBtn}
                          >
                            <Feather name="trash-2" size={13} color="#dc2626" />
                          </Pressable>
                        )
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.replyContent,
                        { color: colors.foreground },
                      ]}
                    >
                      {reply.content}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ComposerModal({
  visible,
  editingPost,
  replyingToPost,
  currentMemberId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  editingPost: Message | null;
  replyingToPost: Message | null;
  currentMemberId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const createMessage = useCreateMessage();
  const updateMessage = useUpdateMessage();
  const { data: members } = useListMembers();
  const { data: customers } = useListCustomers({});

  const [content, setContent] = useState("");
  const [colorTag, setColorTag] = useState("yellow");
  const [mood, setMood] = useState<string | null>(null);
  // Empty = post to All Team; one or more ids = private note fanned out to
  // each selected member (each gets their own copy/thread).
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const isReplying = !!replyingToPost;

  useEffect(() => {
    if (!visible) return;
    if (editingPost) {
      const { mood: m, body } = splitMood(editingPost.content);
      setContent(body);
      setMood(m?.value ?? null);
      setColorTag(editingPost.colorTag);
      setRecipientIds(editingPost.recipientId != null ? [editingPost.recipientId] : []);
      setCustomerId(editingPost.customerId ?? null);
    } else {
      setContent("");
      setMood(null);
      setColorTag(replyingToPost?.colorTag ?? "yellow");
      setRecipientIds(replyingToPost?.recipientId != null ? [replyingToPost.recipientId] : []);
      setCustomerId(replyingToPost?.customerId ?? null);
    }
    setShowRecipientPicker(false);
    setShowCustomerPicker(false);
    setSaving(false);
  }, [visible, editingPost, replyingToPost]);

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      if (editingPost) {
        await updateMessage.mutateAsync({
          id: editingPost.id,
          data: { content: withMood(mood, trimmed), colorTag },
        });
      } else if (replyingToPost) {
        await createMessage.mutateAsync({
          data: {
            content: trimmed,
            colorTag,
            parentMessageId: replyingToPost.id,
          },
        });
      } else {
        await createMessage.mutateAsync({
          data: {
            content: withMood(mood, trimmed),
            colorTag,
            recipientIds: recipientIds.length > 0 ? recipientIds : undefined,
            customerId: customerId ?? undefined,
          },
        });
      }
      onSaved();
    } catch {
      Alert.alert("Error", "Could not save your post. Please try again.");
      setSaving(false);
    }
  };

  const recipientName =
    recipientIds.length === 0
      ? "All Team"
      : recipientIds.length === 1
        ? members?.find((m) => m.id === recipientIds[0])?.name ?? "—"
        : `${recipientIds.length} people`;
  const customerName =
    customerId == null
      ? "No customer"
      : customers?.find((c) => c.id === customerId)?.name ?? "—";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
              {editingPost ? "Edit Post" : isReplying ? "Reply" : "New Post"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {isReplying && replyingToPost ? (
            <View
              style={[
                styles.replyContext,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.replyContextLabel, { color: colors.mutedForeground }]}
              >
                Replying to {replyingToPost.authorName || "Unknown"}
              </Text>
              <Text
                style={[styles.replyContextBody, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {replyingToPost.content}
              </Text>
            </View>
          ) : null}

          <TextInput
            style={[
              styles.input,
              styles.textarea,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            placeholder={isReplying ? "Write your reply…" : "Write your note…"}
            placeholderTextColor={colors.mutedForeground}
            value={content}
            onChangeText={setContent}
            multiline
            autoFocus
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            Color
          </Text>
          <View style={styles.colorRow}>
            {COLOR_OPTIONS.map((c) => {
              const selected = colorTag === c.value;
              return (
                <Pressable
                  key={c.value}
                  onPress={() => setColorTag(c.value)}
                  style={[
                    styles.colorSwatch,
                    {
                      backgroundColor: c.color,
                      borderColor: selected ? colors.foreground : "transparent",
                      transform: [{ scale: selected ? 1.15 : 1 }],
                    },
                  ]}
                >
                  {selected ? (
                    <Feather name="check" size={16} color="#fff" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {!isReplying ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                Mood (optional)
              </Text>
              <View style={styles.moodRow}>
                {MOOD_OPTIONS.map((m) => {
                  const selected = mood === m.value;
                  return (
                    <Pressable
                      key={m.value}
                      onPress={() =>
                        setMood((prev) => (prev === m.value ? null : m.value))
                      }
                      style={[
                        styles.moodChip,
                        {
                          backgroundColor: selected ? colors.accent : colors.background,
                          borderColor: selected ? colors.foreground : colors.border,
                        },
                      ]}
                    >
                      <Text style={styles.moodChipEmoji}>{m.emoji}</Text>
                      <Text
                        style={[
                          styles.moodChipLabel,
                          {
                            color: selected ? colors.foreground : colors.mutedForeground,
                          },
                        ]}
                      >
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {!editingPost && !isReplying ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                To
              </Text>
              <Pressable
                style={[
                  styles.pickerRow,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
                onPress={() => setShowRecipientPicker(true)}
              >
                <Feather name="users" size={15} color={colors.mutedForeground} />
                <Text style={[styles.pickerText, { color: colors.foreground }]}>
                  {recipientName}
                </Text>
                <Feather
                  name="chevron-down"
                  size={15}
                  color={colors.mutedForeground}
                />
              </Pressable>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                Link to customer (optional)
              </Text>
              <Pressable
                style={[
                  styles.pickerRow,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
                onPress={() => setShowCustomerPicker(true)}
              >
                <Feather
                  name="briefcase"
                  size={15}
                  color={colors.mutedForeground}
                />
                <Text style={[styles.pickerText, { color: colors.foreground }]}>
                  {customerName}
                </Text>
                <Feather
                  name="chevron-down"
                  size={15}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </>
          ) : null}

          <View style={styles.formActions}>
            <Pressable
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
            >
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.submitBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: !content.trim() || saving ? 0.5 : 1,
                },
              ]}
              onPress={submit}
              disabled={!content.trim() || saving}
            >
              <Text style={styles.submitText}>
                {saving
                  ? "Saving…"
                  : editingPost
                  ? "Save Changes"
                  : isReplying
                  ? "Post Reply"
                  : "Post Note"}
              </Text>
            </Pressable>
          </View>
        </View>

        <PickerSheet
          visible={showRecipientPicker}
          title="Send to"
          onClose={() => setShowRecipientPicker(false)}
          options={[
            { id: null, label: "All Team", sub: "Visible to everyone" },
            ...(members ?? [])
              .filter((m) => m.id !== currentMemberId)
              .map((m) => ({ id: m.id, label: m.name, sub: m.role ?? "" })),
          ]}
          selectedId={recipientIds.length === 1 ? recipientIds[0] : null}
          selectedIds={recipientIds}
          onSelect={(id) => {
            if (id == null) {
              // "All Team" clears any private recipients.
              setRecipientIds([]);
              setShowRecipientPicker(false);
              return;
            }
            // Toggle membership; keep the sheet open so multiple people can
            // be picked in one pass.
            setRecipientIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            );
          }}
        />

        <PickerSheet
          visible={showCustomerPicker}
          title="Link to customer"
          onClose={() => setShowCustomerPicker(false)}
          options={[
            { id: null, label: "No customer", sub: "" },
            ...(customers ?? []).map((c) => ({
              id: c.id,
              label: c.name,
              sub: "",
            })),
          ]}
          selectedId={customerId}
          onSelect={(id) => {
            setCustomerId(id);
            setShowCustomerPicker(false);
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PickerSheet({
  visible,
  title,
  options,
  selectedId,
  selectedIds,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { id: number | null; label: string; sub?: string }[];
  selectedId: number | null;
  // Optional multi-select highlight set; when provided it wins over selectedId.
  selectedIds?: number[];
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View
        style={[
          styles.pickerSheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
        <Text
          style={[styles.sheetTitle, { color: colors.foreground, marginBottom: 8 }]}
        >
          {title}
        </Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {options.map((opt) => {
            const selected = selectedIds
              ? opt.id == null
                ? selectedIds.length === 0
                : selectedIds.includes(opt.id)
              : opt.id === selectedId;
            return (
              <Pressable
                key={String(opt.id ?? "none")}
                style={[
                  styles.memberOption,
                  {
                    borderColor: colors.border,
                    backgroundColor: selected ? colors.accent : "transparent",
                  },
                ]}
                onPress={() => onSelect(opt.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}
                  >
                    {opt.label}
                  </Text>
                  {opt.sub ? (
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        fontFamily: "Inter_400Regular",
                      }}
                    >
                      {opt.sub}
                    </Text>
                  ) : null}
                </View>
                {selected ? (
                  <Feather name="check" size={16} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function ThemePickerSheet({
  visible,
  selectedValue,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View
        style={[
          styles.pickerSheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />
        <Text
          style={[styles.sheetTitle, { color: colors.foreground, marginBottom: 8 }]}
        >
          Board background
        </Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {BOARD_THEMES.map((t) => {
            const selected = t.value === selectedValue;
            return (
              <Pressable
                key={t.value}
                style={[
                  styles.memberOption,
                  {
                    borderColor: colors.border,
                    backgroundColor: selected ? colors.accent : "transparent",
                  },
                ]}
                onPress={() => onSelect(t.value)}
              >
                <View
                  style={[
                    styles.themeSwatch,
                    {
                      backgroundColor: t.swatch,
                      borderColor: colors.border,
                    },
                  ]}
                />
                <Text
                  style={{
                    flex: 1,
                    color: colors.foreground,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  {t.label}
                </Text>
                {selected ? (
                  <Feather name="check" size={16} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", fontSize: 20, fontFamily: "Inter_700Bold" },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  loading: { padding: 24, textAlign: "center", fontFamily: "Inter_400Regular" },
  card: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  colorBar: { width: 6 },
  cardBody: { flex: 1, padding: 12, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: { padding: 4 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cardHeaderText: { flex: 1, gap: 1 },
  author: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  privateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  privateText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  customerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  customer: { fontSize: 12, fontFamily: "Inter_500Medium" },
  content_: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  threadFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 2,
  },
  replyAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  replyActionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  lastReplyPreview: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  lastReplyAuthor: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  lastReplyText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  repliesContainer: {
    borderLeftWidth: 2,
    paddingLeft: 10,
    gap: 10,
    marginTop: 2,
  },
  replyRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  replyRowNew: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderLeftWidth: 2,
    borderLeftColor: "#f59e0b",
    marginLeft: -10,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  replyNewPill: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  replyNewPillText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  replyAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  replyAvatarText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  replyHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  replyAuthor: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  replyMeta: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular" },
  replyContent: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  replyContext: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  replyContextLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  replyContextBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 100, textAlignVertical: "top" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  colorRow: { flexDirection: "row", gap: 12, paddingVertical: 4 },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  moodRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 2 },
  moodChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  moodChipEmoji: { fontSize: 14 },
  moodChipLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  moodBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  moodBadgeEmoji: { fontSize: 13 },
  moodBadgeLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  themeSwatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: 12,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  formActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  submitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 8,
    maxHeight: "70%",
  },
  memberOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  newReplyBadge: {
    backgroundColor: "#dc2626",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  newReplyBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
});

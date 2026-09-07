import { Feather } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useAuth } from "@clerk/expo";
import { router, Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getListVoiceNoteForwardsQueryKey,
  useListVoiceNoteForwards,
  useMarkVoiceNoteForwardRead,
  type VoiceNoteForward,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ForwardRow({
  forward,
  audioBaseUrl,
  token,
  onMarkRead,
  isPlaying,
  onPlay,
}: {
  forward: VoiceNoteForward;
  audioBaseUrl: string;
  token: string | null;
  onMarkRead: (id: number) => void;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const colors = useColors();
  const unread = !forward.readAt;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: unread ? "#eff6ff" : colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.rowHeader}>
        <View style={[styles.iconCircle, { backgroundColor: "#fee2e2" }]}>
          <Feather name="mic" size={14} color="#b91c1c" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {unread ? (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={styles.badgeText}>NEW</Text>
              </View>
            ) : null}
            <Text style={[styles.sender, { color: colors.foreground }]}>
              From {forward.senderName ?? "Unknown"}
            </Text>
          </View>
          {forward.customerName ? (
            <Pressable
              onPress={() => {
                if (forward.customerId) router.push(`/customer/${forward.customerId}`);
              }}
            >
              <Text style={[styles.customer, { color: colors.primary }]}>
                {forward.customerName}
              </Text>
            </Pressable>
          ) : forward.prospectName ? (
            <Pressable
              onPress={() => {
                if (forward.prospectId) router.push(`/prospect/${forward.prospectId}`);
              }}
            >
              <Text style={[styles.customer, { color: colors.primary }]}>
                {forward.prospectName}
              </Text>
            </Pressable>
          ) : null}
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {formatDate(forward.createdAt)}
          </Text>
        </View>
      </View>

      {forward.subject ? (
        <Text style={[styles.subject, { color: colors.foreground }]}>{forward.subject}</Text>
      ) : null}

      {forward.note ? (
        <View style={[styles.noteBox, { borderLeftColor: colors.primary, backgroundColor: colors.background }]}>
          <Text style={[styles.noteLabel, { color: colors.mutedForeground }]}>NOTE</Text>
          <Text style={[styles.noteText, { color: colors.foreground }]}>{forward.note}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {forward.audioPath && token ? (
          <Pressable
            onPress={onPlay}
            style={[styles.playBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name={isPlaying ? "pause" : "play"} size={14} color="#fff" />
            <Text style={styles.playText}>{isPlaying ? "Pause" : "Play"}</Text>
          </Pressable>
        ) : null}
        {unread ? (
          <Pressable
            onPress={() => onMarkRead(forward.id)}
            style={[styles.markBtn, { borderColor: colors.border }]}
          >
            <Feather name="check" size={12} color={colors.mutedForeground} />
            <Text style={[styles.markText, { color: colors.mutedForeground }]}>Mark read</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function VoiceInboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = getListVoiceNoteForwardsQueryKey();
  const { data: forwards, isLoading, refetch } = useListVoiceNoteForwards(undefined, {
    query: { queryKey },
  });
  const { mutateAsync: markRead } = useMarkVoiceNoteForwardRead();
  const [playingId, setPlayingId] = useState<number | null>(null);
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const audioBaseUrl = domain ? `https://${domain}/api/voice-notes` : "";

  useEffect(() => {
    getToken().then((t) => setToken(t));
  }, [getToken]);

  const playingForward = useMemo(
    () => forwards?.find((f) => f.id === playingId) ?? null,
    [forwards, playingId],
  );
  const playingUrl = playingForward && token
    ? playingForward.prospectVoiceNoteId
      ? `${audioBaseUrl}/${playingForward.prospectVoiceNoteId}/audio?context=prospect&token=${encodeURIComponent(token)}`
      : `${audioBaseUrl}/${playingForward.voiceNoteId}/audio?token=${encodeURIComponent(token)}`
    : null;
  const player = useAudioPlayer(playingUrl ? { uri: playingUrl } : null);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!player || !playingUrl) return;
    player.play();
    return () => {
      try { player.pause(); } catch { /* ignore */ }
    };
  }, [player, playingUrl]);

  useEffect(() => {
    if (playerStatus?.didJustFinish) setPlayingId(null);
  }, [playerStatus?.didJustFinish]);

  const handlePlay = (forward: VoiceNoteForward) => {
    if (playingId === forward.id) {
      try { player?.pause(); } catch { /* ignore */ }
      setPlayingId(null);
    } else {
      setPlayingId(forward.id);
      if (!forward.readAt) handleMarkRead(forward.id);
    }
  };

  const handleMarkRead = async (id: number) => {
    try {
      await markRead({ id });
      queryClient.invalidateQueries({ queryKey });
    } catch {
      // silent
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "Voice Inbox" }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Voice Inbox</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !forwards || forwards.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="inbox"
            title="No forwarded voice notes"
            subtitle="When a teammate forwards you a voice note, it will appear here."
          />
        </View>
      ) : (
        <FlatList
          data={forwards}
          keyExtractor={(f) => String(f.id)}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
          onRefresh={refetch}
          refreshing={false}
          renderItem={({ item }) => (
            <ForwardRow
              forward={item}
              audioBaseUrl={audioBaseUrl}
              token={token}
              onMarkRead={handleMarkRead}
              isPlaying={playingId === item.id}
              onPlay={() => handlePlay(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  row: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  rowHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { color: "#fff", fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  sender: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  customer: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  subject: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  noteBox: { padding: 10, borderLeftWidth: 3, borderRadius: 6 },
  noteLabel: { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.6, marginBottom: 2 },
  noteText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  playText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  markBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  markText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

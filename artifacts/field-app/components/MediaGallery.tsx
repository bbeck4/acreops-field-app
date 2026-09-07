import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  useListMediaAttachments,
  getListMediaAttachmentsQueryKey,
  deleteMediaAttachment as deleteMediaAttachmentReq,
  type MediaAttachment,
} from "@workspace/api-client-react";

export interface MediaContext {
  customerId?: number;
  prospectId?: number;
  workOrderId?: number;
  workItemId?: number;
}

interface Props {
  context: MediaContext;
  /** When true, shows delete controls (manager/admin). */
  canDelete?: boolean;
  /** Optional heading shown above the grid. */
  title?: string;
}

function isVideo(a: MediaAttachment): boolean {
  return (a.contentType ?? "").startsWith("video/");
}

function contextToParams(ctx: MediaContext): Record<string, number> {
  if (ctx.customerId != null) return { customerId: ctx.customerId };
  if (ctx.prospectId != null) return { prospectId: ctx.prospectId };
  if (ctx.workOrderId != null) return { workOrderId: ctx.workOrderId };
  if (ctx.workItemId != null) return { workItemId: ctx.workItemId };
  return {};
}

function contextQueryString(ctx: MediaContext): string {
  if (ctx.customerId != null) return `customerId=${ctx.customerId}`;
  if (ctx.prospectId != null) return `prospectId=${ctx.prospectId}`;
  if (ctx.workOrderId != null) return `workOrderId=${ctx.workOrderId}`;
  if (ctx.workItemId != null) return `workItemId=${ctx.workItemId}`;
  return "";
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

interface PendingUpload {
  key: string;
  progress: number;
  isVideo: boolean;
  error?: boolean;
}

/**
 * Upload a single file as raw bytes with progress reporting. Uses XHR because
 * RN's fetch() does not expose upload progress events.
 */
function uploadWithProgress(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(blob);
  });
}

function VideoViewerPlayer({ uri, headers }: { uri: string; headers: Record<string, string> }) {
  const player = useVideoPlayer({ uri, headers }, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <VideoView
      style={styles.viewerMedia}
      player={player}
      fullscreenOptions={{ enable: true }}
      contentFit="contain"
      nativeControls
    />
  );
}

export function MediaGallery({ context, canDelete = false, title }: Props) {
  const colors = useColors();
  const { getToken } = useAuth();

  const params = useMemo(() => contextToParams(context), [context]);
  const hasContext = Object.keys(params).length > 0;

  const { data, isLoading, refetch } = useListMediaAttachments(params, {
    query: { enabled: hasContext, queryKey: getListMediaAttachmentsQueryKey(params) },
  });
  const items = data ?? [];

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getToken()
      .then((t) => {
        if (active) setAuthToken(t ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [getToken]);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const headersFor = useCallback(
    (token: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [],
  );

  const rawUri = useCallback(
    (id: number) => `https://${domain}/api/media-attachments/${id}/raw`,
    [domain],
  );

  const uploadAssets = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[]) => {
      if (!domain) {
        Alert.alert("Upload failed", "API domain is not configured.");
        return;
      }
      const token = await getToken();
      if (!token) {
        Alert.alert("Upload failed", "You are not signed in.");
        return;
      }
      const qs = contextQueryString(context);
      const url = `https://${domain}/api/media-attachments/upload?${qs}`;

      const newPending: PendingUpload[] = assets.map((a, i) => ({
        key: `${Date.now()}-${i}`,
        progress: 0,
        isVideo: a.type === "video",
      }));
      setPending((prev) => [...newPending, ...prev]);

      await Promise.all(
        assets.map(async (asset, i) => {
          const pendingKey = newPending[i].key;
          try {
            const resp = await fetch(asset.uri);
            const blob = await resp.blob();
            const contentType =
              asset.mimeType ||
              blob.type ||
              (asset.type === "video" ? "video/mp4" : "image/jpeg");
            const headers: Record<string, string> = {
              Authorization: `Bearer ${token}`,
              "Content-Type": contentType,
            };
            if (asset.fileName) headers["X-Filename"] = encodeURIComponent(asset.fileName);
            if (asset.type === "video" && asset.duration != null) {
              headers["X-Duration-Seconds"] = String(asset.duration / 1000);
            }
            await uploadWithProgress(url, blob, headers, (fraction) => {
              setPending((prev) =>
                prev.map((p) => (p.key === pendingKey ? { ...p, progress: fraction } : p)),
              );
            });
            setPending((prev) => prev.filter((p) => p.key !== pendingKey));
          } catch {
            setPending((prev) =>
              prev.map((p) => (p.key === pendingKey ? { ...p, error: true } : p)),
            );
          }
        }),
      );

      await refetch();
    },
    [context, domain, getToken, refetch],
  );

  const handleTakePhoto = useCallback(async () => {
    setMenuOpen(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Camera access is required to take photos.");
        return;
      }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (!r.canceled) await uploadAssets(r.assets);
    } catch (e) {
      Alert.alert("Camera error", e instanceof Error ? e.message : "Could not open camera.");
    }
  }, [uploadAssets]);

  const handleRecordVideo = useCallback(async () => {
    setMenuOpen(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Camera access is required to record video.");
        return;
      }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], quality: 0.7 });
      if (!r.canceled) await uploadAssets(r.assets);
    } catch (e) {
      Alert.alert("Camera error", e instanceof Error ? e.message : "Could not open camera.");
    }
  }, [uploadAssets]);

  const handlePickLibrary = useCallback(async () => {
    setMenuOpen(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Library access is required to choose media.");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 0.7,
      });
      if (!r.canceled) await uploadAssets(r.assets);
    } catch (e) {
      Alert.alert("Library error", e instanceof Error ? e.message : "Could not open library.");
    }
  }, [uploadAssets]);

  const confirmDelete = useCallback(
    (id: number) => {
      const doDelete = async () => {
        setDeletingId(id);
        try {
          await deleteMediaAttachmentReq(id);
          setViewerIndex(null);
          await refetch();
        } catch {
          Alert.alert("Delete failed", "Could not delete this attachment.");
        } finally {
          setDeletingId(null);
        }
      };
      if (Platform.OS === "web") {
        if (typeof window !== "undefined" && window.confirm("Delete this attachment permanently?")) {
          void doDelete();
        }
        return;
      }
      Alert.alert("Delete attachment", "Delete this attachment permanently?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void doDelete() },
      ]);
    },
    [refetch],
  );

  const numColumns = 3;
  const screenWidth = Dimensions.get("window").width;
  const gridPadding = 16;
  const gap = 6;
  const tileSize = Math.floor((Math.min(screenWidth, 720) - gridPadding * 2 - gap * (numColumns - 1)) / numColumns);

  if (!hasContext) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {title ?? "Photos & Videos"}
          {items.length ? ` (${items.length})` : ""}
        </Text>
        <Pressable
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setMenuOpen(true)}
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Add</Text>
        </Pressable>
      </View>

      {pending.length > 0 ? (
        <View style={styles.pendingRow}>
          {pending.map((p) => (
            <View key={p.key} style={[styles.pendingTile, { width: tileSize, height: tileSize, backgroundColor: colors.muted }]}>
              {p.error ? (
                <Feather name="alert-triangle" size={20} color={colors.destructive} />
              ) : (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.pendingPct, { color: colors.mutedForeground }]}>
                    {Math.round(p.progress * 100)}%
                  </Text>
                </>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 && pending.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="image" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No photos or videos yet
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          numColumns={numColumns}
          scrollEnabled={false}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={{ gap }}
          renderItem={({ item, index }) => (
            <Pressable
              style={[styles.tile, { width: tileSize, height: tileSize, backgroundColor: colors.muted }]}
              onPress={() => setViewerIndex(index)}
              onLongPress={canDelete ? () => confirmDelete(item.id) : undefined}
            >
              {isVideo(item) ? (
                <View style={styles.videoTile}>
                  <Feather name="play-circle" size={28} color="#ffffff" />
                  {item.durationSeconds ? (
                    <Text style={styles.videoDuration}>{formatDuration(item.durationSeconds)}</Text>
                  ) : null}
                </View>
              ) : (
                <Image
                  source={{ uri: rawUri(item.id), headers: headersFor(authToken) }}
                  style={styles.tileImage}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="disk"
                />
              )}
            </Pressable>
          )}
        />
      )}

      {/* Add-media action sheet */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menuSheet, { backgroundColor: colors.card }]}>
            <MenuItem icon="camera" label="Take Photo" color={colors.foreground} onPress={handleTakePhoto} />
            <MenuItem icon="video" label="Record Video" color={colors.foreground} onPress={handleRecordVideo} />
            <MenuItem icon="image" label="Choose from Library" color={colors.foreground} onPress={handlePickLibrary} />
            <Pressable style={styles.menuCancel} onPress={() => setMenuOpen(false)}>
              <Text style={[styles.menuCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Full-screen viewer */}
      <Modal
        visible={viewerIndex !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
      >
        <View style={styles.viewer}>
          {viewerIndex !== null && items[viewerIndex] ? (
            <>
              {isVideo(items[viewerIndex]) ? (
                <VideoViewerPlayer
                  uri={rawUri(items[viewerIndex].id)}
                  headers={headersFor(authToken)}
                />
              ) : (
                <Image
                  source={{ uri: rawUri(items[viewerIndex].id), headers: headersFor(authToken) }}
                  style={styles.viewerMedia}
                  contentFit="contain"
                  cachePolicy="disk"
                />
              )}

              <Pressable
                style={[styles.viewerClose, { backgroundColor: "rgba(0,0,0,0.55)" }]}
                onPress={() => setViewerIndex(null)}
              >
                <Feather name="x" size={24} color="#ffffff" />
              </Pressable>

              {viewerIndex > 0 ? (
                <Pressable
                  style={[styles.viewerNav, styles.viewerNavLeft]}
                  onPress={() => setViewerIndex(viewerIndex - 1)}
                >
                  <Feather name="chevron-left" size={28} color="#ffffff" />
                </Pressable>
              ) : null}
              {viewerIndex < items.length - 1 ? (
                <Pressable
                  style={[styles.viewerNav, styles.viewerNavRight]}
                  onPress={() => setViewerIndex(viewerIndex + 1)}
                >
                  <Feather name="chevron-right" size={28} color="#ffffff" />
                </Pressable>
              ) : null}

              <View style={styles.viewerFooter}>
                <Text style={styles.viewerMeta} numberOfLines={1}>
                  {items[viewerIndex].uploaderName ? `${items[viewerIndex].uploaderName} · ` : ""}
                  {new Date(items[viewerIndex].createdAt).toLocaleDateString()}
                </Text>
                {canDelete ? (
                  <Pressable
                    style={styles.viewerDelete}
                    onPress={() => confirmDelete(items[viewerIndex].id)}
                    disabled={deletingId === items[viewerIndex].id}
                  >
                    {deletingId === items[viewerIndex].id ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Feather name="trash-2" size={20} color="#ffffff" />
                    )}
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <Feather name={icon} size={20} color={color} />
      <Text style={[styles.menuItemText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "600" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { fontSize: 14, fontWeight: "600" },
  loading: { paddingVertical: 32, alignItems: "center" },
  empty: { paddingVertical: 32, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14 },
  pendingRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pendingTile: { borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 4 },
  pendingPct: { fontSize: 12 },
  tile: { borderRadius: 8, overflow: "hidden" },
  tileImage: { width: "100%", height: "100%" },
  videoTile: {
    flex: 1,
    backgroundColor: "#1f1f1f",
    alignItems: "center",
    justifyContent: "center",
  },
  videoDuration: {
    position: "absolute",
    bottom: 4,
    right: 6,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menuSheet: { padding: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 4 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 8 },
  menuItemText: { fontSize: 16, fontWeight: "500" },
  menuCancel: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  menuCancelText: { fontSize: 16, fontWeight: "600" },
  viewer: { flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  viewerMedia: { width: "100%", height: "100%" },
  viewerClose: {
    position: "absolute",
    top: 48,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerNav: {
    position: "absolute",
    top: "50%",
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerNavLeft: { left: 12 },
  viewerNavRight: { right: 12 },
  viewerFooter: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewerMeta: { color: "#ffffff", fontSize: 13, flex: 1 },
  viewerDelete: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(214,38,38,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
});

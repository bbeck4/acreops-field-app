import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router, useLocalSearchParams, Stack } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  useGetDeliveryStop,
  useSendDeliveryReceipt,
  getGetDeliveryStopQueryKey,
  getGetDeliveryLoadQueryKey,
  getListDeliveryLoadsQueryKey,
} from "@workspace/api-client-react";

import { OfflineBanner } from "@/components/OfflineBanner";
import { SignaturePad, SignaturePadActions, type SignaturePadHandle } from "@/components/SignaturePad";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { canNavigate, openNavigation } from "@/lib/navigation";
import { usePermissions } from "@/lib/permissions";
import {
  printOrShareHtml,
  renderDeliveryReceiptHtml,
  renderStopPackingSlipHtml,
  renderStopPickListHtml,
} from "@/lib/printDocs";

const INCIDENT_REASONS = [
  "Customer not present",
  "Refused delivery",
  "Address issue",
  "Damaged product",
  "Equipment failure",
  "Other",
];

type UploadedPhoto = { localUri: string; objectPath: string | null; uploading: boolean };

async function requestUploadUrl(name: string, contentType: string, size: number, token: string) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("Missing API domain");
  const res = await fetch(`https://${domain}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, contentType, size }),
  });
  if (!res.ok) throw new Error(`Failed to request upload URL: ${res.status}`);
  return (await res.json()) as { uploadURL: string; objectPath: string };
}

async function uploadAsset(uri: string, uploadURL: string, contentType: string, token: string) {
  const blob = await (await fetch(uri)).blob();
  const res = await fetch(uploadURL, {
    method: "PUT",
    body: blob,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

async function uploadSignatureSvg(svg: string, token: string): Promise<string> {
  const contentType = "image/svg+xml";
  const name = `signature-${Date.now()}.svg`;
  const size = new Blob([svg]).size;
  const { uploadURL, objectPath } = await requestUploadUrl(name, contentType, size, token);
  const res = await fetch(uploadURL, {
    method: "PUT",
    body: svg,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
  });
  if (!res.ok) throw new Error(`Signature upload failed: ${res.status}`);
  return objectPath;
}

export default function StopDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const stopId = Number(params.id);
  const { getToken } = useAuth();
  const { queueWrite, triggerFlush, isOnline } = useOffline();
  const queryClient = useQueryClient();
  const { canDo } = usePermissions();
  // Delivery field writes (PoD capture, incidents, receipt emails) require the
  // explicit `deliveries.edit` permission — the same key the server guards these
  // endpoints with. Without it the screen stays read-only.
  const canEditDelivery = canDo("deliveries.edit");

  const { data: stop, isLoading } = useGetDeliveryStop(stopId, {
    query: {
      queryKey: getGetDeliveryStopQueryKey(stopId),
      enabled: Number.isFinite(stopId),
    },
  });

  const { mutateAsync: sendReceipt, isPending: sendingReceipt } =
    useSendDeliveryReceipt();

  const [signedByName, setSignedByName] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptEmail, setReceiptEmail] = useState("");
  const [receiptChannel, setReceiptChannel] = useState<"email" | "sms">("email");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const signatureRef = useRef<SignaturePadHandle>(null);
  const [showIncident, setShowIncident] = useState(false);
  const [incidentReason, setIncidentReason] = useState("");
  const [incidentNotes, setIncidentNotes] = useState("");
  const [incidentSubmitting, setIncidentSubmitting] = useState(false);

  const isComplete = useMemo(
    () => !!(stop && (stop.status === "delivered" || stop.status === "cancelled")),
    [stop],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetDeliveryStopQueryKey(stopId) });
    if (stop?.loadWorkItemId) {
      queryClient.invalidateQueries({
        queryKey: getGetDeliveryLoadQueryKey(stop.loadWorkItemId),
      });
    }
    queryClient.invalidateQueries({ queryKey: getListDeliveryLoadsQueryKey(), exact: false });
  };

  const handleAddPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Allow camera access to capture proof photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const localUri = asset.uri;
    const idx = photos.length;
    setPhotos((prev) => [...prev, { localUri, objectPath: null, uploading: true }]);

    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const contentType = asset.mimeType ?? "image/jpeg";
      const name = asset.fileName ?? `pod-${Date.now()}.jpg`;
      const size = asset.fileSize ?? 0;
      const { uploadURL, objectPath } = await requestUploadUrl(name, contentType, size, token);
      await uploadAsset(localUri, uploadURL, contentType, token);
      setPhotos((prev) => {
        const next = [...prev];
        next[idx] = { localUri, objectPath, uploading: false };
        return next;
      });
    } catch (err) {
      setPhotos((prev) => prev.filter((_, i) => i !== idx));
      Alert.alert("Photo upload failed", err instanceof Error ? err.message : "Try again.");
    }
  };

  const captureGps = async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        const req = await Location.requestForegroundPermissionsAsync();
        if (!req.granted) return null;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    } catch {
      return null;
    }
  };

  const handleComplete = async () => {
    if (!stop) return;
    if (photos.some((p) => p.uploading)) {
      Alert.alert("Hang on", "Wait for photos to finish uploading.");
      return;
    }
    setSubmitting(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      let signaturePath: string | null = null;
      const svg = signatureRef.current?.toSvg() ?? null;
      if (svg) {
        try {
          const token = await getToken();
          if (!token) throw new Error("Not signed in");
          signaturePath = await uploadSignatureSvg(svg, token);
        } catch (err) {
          setSubmitting(false);
          Alert.alert(
            "Signature upload failed",
            err instanceof Error ? err.message : "Try again.",
          );
          return;
        }
      }
      const gps = await captureGps();
      const body = {
        completedAt: new Date().toISOString(),
        signedByName: signedByName.trim() || null,
        notes: notes.trim() || null,
        photoPaths: photos.map((p) => p.objectPath).filter((p): p is string => !!p),
        signaturePath,
        gpsLat: gps?.lat ?? null,
        gpsLon: gps?.lon ?? null,
      };
      await queueWrite("completeDeliveryStop", { stopId: stop.id, body });
      if (isOnline) triggerFlush();
      invalidate();
      router.back();
    } catch (err) {
      Alert.alert("Couldn't complete stop", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReceipt = async () => {
    if (!stop) return;
    const isSms = receiptChannel === "sms";
    if (!isOnline) {
      Alert.alert("You're offline", `Connect to the internet to ${isSms ? "text" : "email"} the receipt.`);
      return;
    }
    const overrideEmail = receiptEmail.trim();
    const overridePhone = receiptPhone.trim();
    if (!isSms && overrideEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideEmail)) {
      Alert.alert("Invalid email", "Enter a valid email address, or leave it blank to use the customer's email on file.");
      return;
    }
    if (isSms && !overridePhone && !stop.customerPhone) {
      Alert.alert("No phone on file", "Enter a phone number to text the receipt link to.");
      return;
    }
    try {
      Haptics.selectionAsync();
      const updated = await sendReceipt({
        id: stop.id,
        data: isSms
          ? { channel: "sms", recipientPhone: overridePhone || null }
          : { channel: "email", recipientEmail: overrideEmail || null },
      });
      invalidate();
      // The SMS path logs to customer activity (not the email-proof record) and
      // only returns 200 on a successful send, so a non-throwing response means
      // it went out. The email path reflects its result on the proof record.
      if (isSms) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setReceiptPhone("");
        Alert.alert(
          "Receipt sent",
          overridePhone
            ? `Texted to ${overridePhone}.`
            : stop.customerPhone
              ? `Texted to ${stop.customerPhone}.`
              : "Text sent.",
        );
        return;
      }
      const status = updated.proof?.emailStatus;
      const recipient = updated.proof?.emailRecipient;
      if (status === "sent") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setReceiptEmail("");
        setReceiptPhone("");
        Alert.alert(
          "Receipt sent",
          recipient
            ? isSms ? `Texted to ${recipient}.` : `Emailed to ${recipient}.`
            : isSms ? "Text sent." : "Email sent.",
        );
      } else if (status === "skipped") {
        Alert.alert(
          "Not sent",
          updated.proof?.emailError ?? (isSms ? "The customer has no phone on file." : "The customer has no email on file."),
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          "Couldn't send receipt",
          updated.proof?.emailError ?? (isSms ? "The text could not be delivered. Try again." : "The email could not be delivered. Try again."),
        );
      }
    } catch (err) {
      Alert.alert("Couldn't send receipt", err instanceof Error ? err.message : "Try again.");
    }
  };

  const handleIncident = async () => {
    if (!stop || !incidentReason) return;
    setIncidentSubmitting(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await queueWrite("deliveryIncident", {
        stopId: stop.id,
        body: { reason: incidentReason, notes: incidentNotes.trim() || null },
      });
      if (isOnline) triggerFlush();
      invalidate();
      setShowIncident(false);
      setIncidentReason("");
      setIncidentNotes("");
      router.back();
    } catch (err) {
      Alert.alert("Couldn't report incident", err instanceof Error ? err.message : "Try again.");
    } finally {
      setIncidentSubmitting(false);
    }
  };

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  if (isLoading || !stop) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.back();
          }}
          style={styles.backBtn}
        >
          <Feather name="chevron-left" size={28} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {stop.customerName ?? "Stop"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            Stop {stop.stopOrder}
            {stop.workOrderNumber ? ` · Order ${stop.workOrderNumber}` : ""}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            printOrShareHtml(
              renderDeliveryReceiptHtml({
                workOrderNumber: stop.workOrderNumber,
                customerName: stop.customerName,
                address: stop.address,
                stopOrder: stop.stopOrder,
                status: stop.status,
                signedByName: stop.proof?.signedByName,
                completedAt: stop.proof?.completedAt ?? stop.completedAt,
                items: stop.items.map((it) => ({
                  productName: it.productName ?? `Product #${it.productId}`,
                  unit: it.unit,
                  quantityOrdered: it.quantityOrdered ?? "—",
                  quantityDelivered: it.quantityDelivered,
                })),
              }),
              `Delivery receipt ${stop.workOrderNumber ?? stop.id}`,
            );
          }}
          style={styles.iconBtn}
          testID="btn-print-delivery-receipt"
        >
          <Feather name="file-text" size={22} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            printOrShareHtml(
              renderStopPickListHtml({
                workOrderNumber: stop.workOrderNumber,
                customerName: stop.customerName,
                address: stop.address,
                instructions: stop.instructions,
                stopOrder: stop.stopOrder,
                status: stop.status,
                items: stop.items.map((it) => ({
                  productName: it.productName ?? `Product #${it.productId}`,
                  unit: it.unit,
                  quantityOrdered: it.quantityOrdered ?? "—",
                  quantityDelivered: it.quantityDelivered,
                })),
              }),
              `Pick list ${stop.workOrderNumber ?? stop.id}`,
            );
          }}
          style={styles.iconBtn}
          testID="btn-print-pick-list"
        >
          <Feather name="printer" size={22} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            printOrShareHtml(
              renderStopPackingSlipHtml({
                workOrderNumber: stop.workOrderNumber,
                customerName: stop.customerName,
                address: stop.address,
                instructions: stop.instructions,
                stopOrder: stop.stopOrder,
                status: stop.status,
                items: stop.items.map((it) => ({
                  productName: it.productName ?? `Product #${it.productId}`,
                  unit: it.unit,
                  quantityOrdered: it.quantityOrdered ?? "—",
                  quantityDelivered: it.quantityDelivered,
                })),
              }),
              `Packing slip ${stop.workOrderNumber ?? stop.id}`,
            );
          }}
          style={styles.iconBtn}
          testID="btn-print-packing-slip"
        >
          <Feather name="share-2" size={22} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 40,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>Address</Text>
          <Text style={[styles.cardValue, { color: colors.foreground }]}>
            {stop.address ?? "No address on file"}
          </Text>
          {canNavigate({ lat: stop.lat, lng: stop.lng, address: stop.address }) && (
            <Pressable
              style={[styles.navigateBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                Haptics.selectionAsync();
                void openNavigation({
                  lat: stop.lat,
                  lng: stop.lng,
                  address: stop.address,
                  label: stop.customerName,
                });
              }}
              testID="btn-navigate-stop"
            >
              <Feather name="navigation" size={16} color="#fff" />
              <Text style={styles.navigateBtnText}>Navigate</Text>
            </Pressable>
          )}
          {stop.instructions && (
            <>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground, marginTop: 8 }]}>
                Delivery instructions
              </Text>
              <Text style={[styles.cardValue, { color: colors.foreground }]}>
                {stop.instructions}
              </Text>
            </>
          )}
        </View>

        {stop.items.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>Items</Text>
            <View style={{ marginTop: 6, gap: 4 }}>
              {stop.items.map((it) => (
                <Text key={it.id} style={[styles.itemRow, { color: colors.foreground }]}>
                  • {it.productName ?? `Product #${it.productId}`} —{" "}
                  {it.quantityOrdered ?? "—"}{it.unit ? ` ${it.unit}` : ""}
                </Text>
              ))}
            </View>
          </View>
        )}

        {isComplete ? (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.completeText, { color: colors.foreground }]}>
                {stop.status === "delivered" ? "✓ Delivered" : "Cancelled"}
              </Text>
              {stop.proof && (
                <Text style={[styles.cardValue, { color: colors.mutedForeground, marginTop: 4 }]}>
                  {new Date(stop.proof.completedAt).toLocaleString()}
                  {stop.proof.signedByName ? ` · signed by ${stop.proof.signedByName}` : ""}
                </Text>
              )}
            </View>

            {stop.status === "delivered" && stop.proof && (
              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Email receipt
                </Text>
                {(() => {
                  const es = stop.proof.emailStatus;
                  let statusText = "Not emailed yet";
                  let statusColor = colors.mutedForeground;
                  if (es === "sent") {
                    statusText = `Emailed${stop.proof.emailRecipient ? ` to ${stop.proof.emailRecipient}` : ""}${
                      stop.proof.emailSentAt
                        ? ` · ${new Date(stop.proof.emailSentAt).toLocaleString()}`
                        : ""
                    }`;
                    statusColor = "#16a34a";
                  } else if (es === "queued") {
                    statusText = "Sending…";
                  } else if (es === "skipped") {
                    statusText = stop.proof.emailError ?? "Skipped (no email on file)";
                  } else if (es === "failed") {
                    statusText = `Failed${stop.proof.emailError ? `: ${stop.proof.emailError}` : ""}`;
                    statusColor = "#dc2626";
                  }
                  return (
                    <Text
                      style={[styles.cardValue, { color: statusColor, marginTop: 4 }]}
                      testID="text-email-status"
                    >
                      {statusText}
                    </Text>
                  );
                })()}
                {canEditDelivery && (
                  <>
                    <View style={{ flexDirection: "row", marginTop: 12, gap: 8 }}>
                      {(["email", "sms"] as const).map((ch) => {
                        const active = receiptChannel === ch;
                        const disabled = ch === "sms" && !stop.customerPhone;
                        return (
                          <Pressable
                            key={ch}
                            onPress={() => !disabled && setReceiptChannel(ch)}
                            disabled={disabled || sendingReceipt}
                            style={({ pressed }) => [
                              styles.secondaryBtn,
                              {
                                flex: 1,
                                borderColor: active ? colors.primary : colors.border,
                                backgroundColor: active ? colors.primary : "transparent",
                                opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
                              },
                            ]}
                            testID={`toggle-receipt-${ch}`}
                          >
                            <Feather
                              name={ch === "email" ? "mail" : "message-square"}
                              size={16}
                              color={active ? colors.primaryForeground : colors.foreground}
                            />
                            <Text
                              style={[
                                styles.secondaryBtnText,
                                { color: active ? colors.primaryForeground : colors.foreground },
                              ]}
                            >
                              {ch === "email" ? "Email" : "Text"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {!stop.customerPhone && (
                      <Text style={[styles.cardValue, { color: colors.mutedForeground, marginTop: 6 }]}>
                        Text is unavailable — no phone on file for this customer.
                      </Text>
                    )}
                    {receiptChannel === "email" ? (
                      <>
                        <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
                          Send to a different email (optional)
                        </Text>
                        <TextInput
                          value={receiptEmail}
                          onChangeText={setReceiptEmail}
                          placeholder="name@example.com"
                          placeholderTextColor={colors.mutedForeground}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                          editable={!sendingReceipt}
                          style={[
                            styles.input,
                            { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
                          ]}
                          testID="input-receipt-email"
                        />
                        <Text style={[styles.cardValue, { color: colors.mutedForeground, marginTop: 6 }]}>
                          Leave blank to use the customer's email on file.
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
                          Send to a different number (optional)
                        </Text>
                        <TextInput
                          value={receiptPhone}
                          onChangeText={setReceiptPhone}
                          placeholder={stop.customerPhone ?? "(555) 123-4567"}
                          placeholderTextColor={colors.mutedForeground}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="phone-pad"
                          editable={!sendingReceipt}
                          style={[
                            styles.input,
                            { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
                          ]}
                          testID="input-receipt-phone"
                        />
                        <Text style={[styles.cardValue, { color: colors.mutedForeground, marginTop: 6 }]}>
                          Sends a short text with a secure, no-login link.
                          {stop.customerPhone ? " Leave blank to use the phone on file." : ""}
                        </Text>
                      </>
                    )}
                    <Pressable
                      onPress={handleSendReceipt}
                      disabled={sendingReceipt}
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        {
                          marginTop: 12,
                          borderColor: colors.border,
                          opacity: pressed || sendingReceipt ? 0.7 : 1,
                        },
                      ]}
                      testID="button-email-receipt"
                    >
                      {sendingReceipt ? (
                        <ActivityIndicator color={colors.foreground} />
                      ) : (
                        <>
                          <Feather name={receiptChannel === "sms" ? "message-square" : "mail"} size={16} color={colors.foreground} />
                          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                            {receiptChannel === "sms"
                              ? stop.proof.emailStatus === "sent"
                                ? "Resend receipt by text"
                                : "Text receipt to customer"
                              : stop.proof.emailStatus === "sent"
                                ? "Resend receipt email"
                                : "Email receipt to customer"}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </>
        ) : (
          <>
            {canEditDelivery ? (
            <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Proof of delivery
              </Text>

              <Text style={[styles.label, { color: colors.foreground }]}>Signed by</Text>
              <TextInput
                value={signedByName}
                onChangeText={setSignedByName}
                placeholder="Receiver's name"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                ]}
                testID="input-signed-by"
              />

              <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
                Notes
              </Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything dispatch should know"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[
                  styles.input,
                  styles.multiline,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                ]}
              />

              <View style={styles.signatureHeader}>
                <Text style={[styles.label, { color: colors.foreground, marginTop: 12, marginBottom: 0 }]}>
                  Signature
                </Text>
                <SignaturePadActions
                  onClear={() => signatureRef.current?.clear()}
                  color={colors.primary}
                  disabled={signatureEmpty}
                />
              </View>
              <SignaturePad
                ref={signatureRef}
                height={180}
                strokeColor={colors.foreground}
                backgroundColor={colors.background}
                borderColor={colors.border}
                mutedColor={colors.mutedForeground}
                onChange={(empty) => setSignatureEmpty(empty)}
              />

              <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
                Photos ({photos.length})
              </Text>
              <View style={styles.photoGrid}>
                {photos.map((p, i) => (
                  <View key={i} style={styles.photoBox}>
                    <Image source={{ uri: p.localUri }} style={styles.photo} />
                    {p.uploading && (
                      <View style={styles.photoOverlay}>
                        <ActivityIndicator color="#fff" />
                      </View>
                    )}
                  </View>
                ))}
                <Pressable
                  onPress={handleAddPhoto}
                  style={[styles.addPhoto, { borderColor: colors.border }]}
                  testID="button-add-photo"
                >
                  <Feather name="camera" size={22} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={handleComplete}
              disabled={submitting}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed || submitting ? 0.7 : 1,
                },
              ]}
              testID="button-complete-stop"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="check" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>Complete delivery</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={() => setShowIncident((v) => !v)}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              testID="button-toggle-incident"
            >
              <Feather name="alert-triangle" size={16} color={colors.foreground} />
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                {showIncident ? "Cancel incident" : "Report incident"}
              </Text>
            </Pressable>

            {showIncident && (
              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  What happened?
                </Text>
                <View style={styles.reasonGrid}>
                  {INCIDENT_REASONS.map((r) => {
                    const selected = incidentReason === r;
                    return (
                      <Pressable
                        key={r}
                        onPress={() => setIncidentReason(r)}
                        style={[
                          styles.reasonChip,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.primary : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? "#fff" : colors.foreground,
                            fontSize: 13,
                            fontFamily: "Inter_500Medium",
                          }}
                        >
                          {r}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={incidentNotes}
                  onChangeText={setIncidentNotes}
                  placeholder="Describe the issue"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[
                    styles.input,
                    styles.multiline,
                    {
                      marginTop: 10,
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                />
                <Pressable
                  onPress={handleIncident}
                  disabled={!incidentReason || incidentSubmitting}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    {
                      marginTop: 12,
                      backgroundColor: "#dc2626",
                      opacity: pressed || incidentSubmitting || !incidentReason ? 0.7 : 1,
                    },
                  ]}
                  testID="button-submit-incident"
                >
                  {incidentSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Submit incident</Text>
                  )}
                </Pressable>
              </View>
            )}
            </>
            ) : (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Proof of delivery
                </Text>
                <Text style={[styles.cardValue, { color: colors.mutedForeground }]} testID="text-delivery-readonly">
                  You don't have permission to capture proof of delivery or report incidents for this stop. Ask a manager if you need delivery access.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  navigateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  navigateBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  root: { flex: 1 },
  header: {
    paddingHorizontal: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backBtn: { padding: 6 },
  iconBtn: { padding: 8 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  center: { alignItems: "center", justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  cardLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" },
  cardValue: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  itemRow: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  completeText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  photoBox: { width: 78, height: 78, borderRadius: 10, overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  photoOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    width: 78,
    height: 78,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  reasonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reasonChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  signatureHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 6,
  },
});

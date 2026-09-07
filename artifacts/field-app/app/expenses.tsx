import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  getListExpenseReportsQueryKey,
  getListExpensesQueryKey,
  useCreateExpense,
  useCreateExpenseReport,
  useDeleteExpense,
  useDeleteExpenseReport,
  useListExpenseReports,
  useListExpenses,
  useTransitionExpense,
  useUpdateExpense,
  useUpdateExpenseReport,
  type Expense,
  type ExpenseEntryType,
  type ExpenseInput,
  type ExpenseReport,
  type ExpenseUpdate,
  type ListExpenseReportsParams,
  type ListExpensesParams,
} from "@workspace/api-client-react";
import { useAuth } from "@clerk/expo";

import { CategoryField } from "@/components/CategoryField";
import { EmptyState } from "@/components/EmptyState";
import {
  ExpenseLinksField,
  draftsToInputs,
  linksToDrafts,
  type LinkDraft,
} from "@/components/ExpenseLinksField";
import { useColors } from "@/hooks/useColors";

interface ReceiptScanResult {
  amountCents: number | null;
  expenseDate: string | null;
  category: string | null;
  vendor: string | null;
  description: string | null;
}

type GetToken = ReturnType<typeof useAuth>["getToken"];

/** Bearer header for authenticated media requests (raw/thumb endpoints). */
function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function receiptThumbUri(mediaId: number): string {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/media-attachments/${mediaId}/thumb`;
}

function receiptRawUri(mediaId: number): string {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/media-attachments/${mediaId}/raw`;
}

function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "#f1f5f9", fg: "#475569" },
  submitted: { bg: "#fef3c7", fg: "#b45309" },
  approved: { bg: "#dbeafe", fg: "#1d4ed8" },
  reimbursed: { bg: "#dcfce7", fg: "#15803d" },
};

function StatusBadge({ status }: { status: string }) {
  const palette = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{status}</Text>
    </View>
  );
}

/** Collect display names from a line's additive links plus its legacy single link. */
function expenseLinkNames(e: Expense): string[] {
  const set = new Set<string>();
  for (const l of e.links ?? []) {
    const n = l.customerName ?? l.prospectName ?? l.projectName;
    if (n) set.add(n);
  }
  const legacy = e.customerName ?? e.prospectName ?? e.projectName;
  if (legacy) set.add(legacy);
  return Array.from(set);
}

function reportLinkNames(r: ExpenseReport): string[] {
  const set = new Set<string>();
  for (const l of r.links ?? []) {
    const n = l.customerName ?? l.prospectName ?? l.projectName;
    if (n) set.add(n);
  }
  return Array.from(set);
}

/** Build the COMPLETE link set for editing: legacy primary first (so it stays
 * the primary when the server re-splits on save), then additive links deduped. */
function expenseToLinkDrafts(e: Expense): LinkDraft[] {
  const drafts: LinkDraft[] = [];
  if (e.customerId != null) {
    drafts.push({ key: `legacy-c-${e.id}`, entityType: "customer", id: e.customerId, name: e.customerName ?? "Customer" });
  } else if (e.prospectId != null) {
    drafts.push({ key: `legacy-p-${e.id}`, entityType: "prospect", id: e.prospectId, name: e.prospectName ?? "Prospect" });
  } else if (e.projectId != null) {
    drafts.push({ key: `legacy-j-${e.id}`, entityType: "project", id: e.projectId, name: e.projectName ?? "Project" });
  }
  for (const d of linksToDrafts(e.links)) {
    if (!drafts.some((x) => x.entityType === d.entityType && x.id === d.id)) drafts.push(d);
  }
  return drafts;
}

/** Prompt for a receipt photo via camera or library. Resolves null on cancel. */
function chooseReceiptAsset(): Promise<ImagePicker.ImagePickerAsset | null> {
  return new Promise((resolve) => {
    Alert.alert(
      "Attach receipt",
      "Choose a source",
      [
        {
          text: "Take photo",
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert("Permission needed", "Camera access is required to take photos.");
              resolve(null);
              return;
            }
            const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
            resolve(!r.canceled && r.assets[0] ? r.assets[0] : null);
          },
        },
        {
          text: "Choose from library",
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert("Permission needed", "Library access is required to choose photos.");
              resolve(null);
              return;
            }
            const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
            resolve(!r.canceled && r.assets[0] ? r.assets[0] : null);
          },
        },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

async function uploadReceipt(
  expenseId: number,
  asset: ImagePicker.ImagePickerAsset,
  getToken: GetToken,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("no domain");
  const token = await getToken();
  if (!token) throw new Error("no token");
  const url = `https://${domain}/api/media-attachments/upload?expenseId=${expenseId}`;
  const resp = await fetch(asset.uri);
  const blob = await resp.blob();
  const contentType = asset.mimeType || blob.type || "image/jpeg";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": contentType,
  };
  if (asset.fileName) headers["X-Filename"] = encodeURIComponent(asset.fileName);
  const res = await fetch(url, { method: "POST", headers, body: blob });
  if (!res.ok) throw new Error(`receipt upload failed: ${res.status}`);
}

function ExpenseCard({
  expense,
  onSubmit,
  onWithdraw,
  onEdit,
  onDelete,
  onViewReceipt,
  authToken,
  busy,
}: {
  expense: Expense;
  onSubmit: (e: Expense) => void;
  onWithdraw: (e: Expense) => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  onViewReceipt: (mediaId: number) => void;
  authToken: string | null;
  busy: boolean;
}) {
  const colors = useColors();
  const linkNames = expenseLinkNames(expense);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Feather
              name={expense.entryType === "mileage" ? "navigation" : "credit-card"}
              size={14}
              color={colors.mutedForeground}
            />
            <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
              {expense.entryType === "mileage"
                ? `${expense.miles ?? 0} mi`
                : expense.category || "Expense"}
            </Text>
          </View>
          <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
            {formatDate(expense.expenseDate)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={[styles.amount, { color: colors.foreground }]}>
            {formatCents(expense.amountCents)}
          </Text>
          <StatusBadge status={expense.status} />
        </View>
      </View>

      {expense.description ? (
        <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
          {expense.description}
        </Text>
      ) : null}

      {linkNames.length > 0 ? (
        <View style={styles.cardMetaRow}>
          {linkNames.map((name) => (
            <View key={name} style={styles.metaChip}>
              <Feather name="link" size={11} color={colors.mutedForeground} />
              <Text style={[styles.metaChipText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {expense.receiptMediaId ? (
        <Pressable
          style={styles.receiptRow}
          onPress={() => onViewReceipt(expense.receiptMediaId!)}
        >
          <Image
            source={{
              uri: receiptThumbUri(expense.receiptMediaId),
              headers: authHeaders(authToken),
            }}
            style={[styles.receiptThumb, { backgroundColor: colors.muted, borderColor: colors.border }]}
            contentFit="cover"
            transition={150}
            cachePolicy="disk"
          />
          <Text style={[styles.receiptLabel, { color: colors.mutedForeground }]}>View receipt</Text>
        </Pressable>
      ) : null}

      {expense.rejectionReason ? (
        <View style={[styles.rejection, { borderTopColor: colors.border }]}>
          <Feather name="alert-circle" size={13} color={colors.destructive} />
          <Text style={[styles.rejectionText, { color: colors.destructive }]}>
            {expense.rejectionReason}
          </Text>
        </View>
      ) : null}

      {expense.status === "draft" ? (
        <>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            disabled={busy}
            onPress={() => onSubmit(expense)}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <>
                <Feather name="send" size={14} color={colors.primaryForeground} />
                <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>
                  Submit
                </Text>
              </>
            )}
          </Pressable>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionBtnOutline, styles.actionBtnFlex, { borderColor: colors.border }]}
              disabled={busy}
              onPress={() => onEdit(expense)}
            >
              <Feather name="edit-2" size={14} color={colors.foreground} />
              <Text style={[styles.actionBtnOutlineText, { color: colors.foreground }]}>Edit</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtnOutline, styles.actionBtnFlex, { borderColor: colors.destructive }]}
              disabled={busy}
              onPress={() => onDelete(expense)}
            >
              <Feather name="trash-2" size={14} color={colors.destructive} />
              <Text style={[styles.actionBtnOutlineText, { color: colors.destructive }]}>Delete</Text>
            </Pressable>
          </View>
        </>
      ) : expense.status === "submitted" ? (
        <Pressable
          style={[styles.actionBtnOutline, { borderColor: colors.border }]}
          disabled={busy}
          onPress={() => onWithdraw(expense)}
        >
          {busy ? (
            <ActivityIndicator color={colors.foreground} size="small" />
          ) : (
            <>
              <Feather name="rotate-ccw" size={14} color={colors.foreground} />
              <Text style={[styles.actionBtnOutlineText, { color: colors.foreground }]}>
                Withdraw
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ExpensesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const listParams: ListExpensesParams = useMemo(() => ({ self: true }), []);
  const reportParams: ListExpenseReportsParams = useMemo(() => ({ self: true }), []);
  const { data: expenses, isLoading, refetch, isRefetching } = useListExpenses(listParams, {
    query: { queryKey: getListExpensesQueryKey(listParams) },
  });
  const {
    data: reports,
    refetch: refetchReports,
    isRefetching: isRefetchingReports,
  } = useListExpenseReports(reportParams, {
    query: { queryKey: getListExpenseReportsQueryKey(reportParams) },
  });
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const deleteReport = useDeleteExpenseReport();
  const transitionExpense = useTransitionExpense();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [reportComposerOpen, setReportComposerOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<ExpenseReport | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [reportId, setReportId] = useState<number | null>(null);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [entryType, setEntryType] = useState<ExpenseEntryType>("general");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [miles, setMiles] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [linkDrafts, setLinkDrafts] = useState<LinkDraft[]>([]);
  const [receiptAsset, setReceiptAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [existingReceipt, setExistingReceipt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const refetchAll = useCallback(async () => {
    await Promise.all([refetch(), refetchReports()]);
  }, [refetch, refetchReports]);

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

  const resetComposer = useCallback(() => {
    setEditingId(null);
    setEntryType("general");
    setCategory("");
    setDescription("");
    setAmount("");
    setMiles("");
    setExpenseDate(todayISO());
    setLinkDrafts([]);
    setReportId(null);
    setReceiptAsset(null);
    setExistingReceipt(false);
  }, []);

  const openCreate = useCallback(() => {
    resetComposer();
    setComposerOpen(true);
  }, [resetComposer]);

  const openEditor = useCallback((e: Expense) => {
    setEditingId(e.id);
    setEntryType(e.entryType);
    setCategory(e.category ?? "");
    setDescription(e.description ?? "");
    setAmount(e.entryType === "general" ? ((e.amountCents ?? 0) / 100).toFixed(2) : "");
    setMiles(e.entryType === "mileage" && e.miles != null ? String(e.miles) : "");
    setExpenseDate(e.expenseDate ?? todayISO());
    setLinkDrafts(expenseToLinkDrafts(e));
    setReportId(e.reportId ?? null);
    setReceiptAsset(null);
    setExistingReceipt(e.receiptMediaId != null);
    setComposerOpen(true);
  }, []);

  const openAdd = useCallback(() => {
    Alert.alert("Add", "What would you like to create?", [
      { text: "Log a single expense", onPress: openCreate },
      { text: "Create a report", onPress: () => setReportComposerOpen(true) },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [openCreate]);

  const rows = useMemo(() => expenses ?? [], [expenses]);
  const reportList = useMemo(() => reports ?? [], [reports]);
  const selectedReport = useMemo(
    () => (reportId != null ? reportList.find((r) => r.id === reportId) ?? null : null),
    [reportId, reportList],
  );

  const totals = useMemo(() => {
    const pending = rows
      .filter((e) => e.status === "submitted" || e.status === "approved")
      .reduce((s, e) => s + e.amountCents, 0);
    const reimbursed = rows
      .filter((e) => e.status === "reimbursed")
      .reduce((s, e) => s + e.amountCents, 0);
    return { pending, reimbursed };
  }, [rows]);

  const { linesByReport, standalone } = useMemo(() => {
    const byReport = new Map<number, Expense[]>();
    const loose: Expense[] = [];
    const knownReportIds = new Set(reportList.map((r) => r.id));
    for (const e of rows) {
      if (e.reportId != null && knownReportIds.has(e.reportId)) {
        const list = byReport.get(e.reportId) ?? [];
        list.push(e);
        byReport.set(e.reportId, list);
      } else {
        loose.push(e);
      }
    }
    return { linesByReport: byReport, standalone: loose };
  }, [rows, reportList]);

  const handleAttachReceipt = useCallback(async () => {
    const asset = await chooseReceiptAsset();
    if (asset) setReceiptAsset(asset);
  }, []);

  const runScan = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const token = domain ? await getToken() : null;
      // Keep the chosen image as the receipt regardless of scan outcome so a
      // failed scan still attaches the photo for manual entry.
      setReceiptAsset(asset);
      if (!domain || !token) {
        Alert.alert("Scan unavailable", "Receipt attached. Enter the details manually.");
        return;
      }
      setScanning(true);
      try {
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        const contentType = asset.mimeType || blob.type || "image/jpeg";
        const scanRes = await fetch(`https://${domain}/api/expenses/scan-receipt`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
          body: blob,
        });
        if (!scanRes.ok) throw new Error(`scan failed: ${scanRes.status}`);
        const data = (await scanRes.json()) as ReceiptScanResult;
        setEntryType("general");
        if (data.amountCents != null) setAmount((data.amountCents / 100).toFixed(2));
        if (data.category) setCategory(data.category);
        if (data.expenseDate) setExpenseDate(data.expenseDate);
        if (data.description) setDescription(data.description);
        const found = data.amountCents != null || data.category || data.expenseDate || data.description;
        Alert.alert(
          found ? "Receipt scanned" : "Nothing detected",
          found
            ? "We filled in what we could read. Review the details and save."
            : "We couldn't read the receipt. Enter the details manually.",
        );
      } catch {
        Alert.alert("Scan failed", "Receipt attached. Enter the details manually.");
      } finally {
        setScanning(false);
      }
    },
    [getToken],
  );

  const handleScanReceipt = useCallback(async () => {
    const asset = await chooseReceiptAsset();
    if (asset) await runScan(asset);
  }, [runScan]);

  const handleSave = useCallback(async () => {
    if (entryType === "general") {
      const dollars = Number(amount);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        Alert.alert("Amount required", "Enter a valid amount for this expense.");
        return;
      }
    } else {
      const m = Number(miles);
      if (!Number.isFinite(m) || m <= 0) {
        Alert.alert("Miles required", "Enter the number of miles driven.");
        return;
      }
    }

    setSaving(true);
    try {
      // links[] is the complete desired set; the server splits the first into
      // the legacy single-link column for backward-compatible reads.
      const links = draftsToInputs(linkDrafts);

      if (editingId != null) {
        const body: ExpenseUpdate = {
          entryType,
          expenseDate,
          description: description.trim() || null,
          reportId,
          links,
        };
        if (entryType === "general") {
          body.category = category.trim() || null;
          body.amountCents = Math.round(Number(amount) * 100);
          body.miles = null;
        } else {
          body.miles = Number(miles);
          body.category = null;
        }

        await updateExpense.mutateAsync({ id: editingId, data: body });
        if (receiptAsset) {
          try {
            await uploadReceipt(editingId, receiptAsset, getToken);
          } catch {
            Alert.alert("Receipt not attached", "Changes were saved but the receipt upload failed.");
          }
        }
      } else {
        const body: ExpenseInput = {
          entryType,
          expenseDate,
          description: description.trim() || null,
          reportId,
          links,
        };
        if (entryType === "general") {
          body.category = category.trim() || null;
          body.amountCents = Math.round(Number(amount) * 100);
        } else {
          body.miles = Number(miles);
        }

        const created = await createExpense.mutateAsync({ data: body });
        if (receiptAsset && created?.id) {
          try {
            await uploadReceipt(created.id, receiptAsset, getToken);
          } catch {
            Alert.alert("Receipt not attached", "The expense was saved but the receipt upload failed.");
          }
        }
      }
      setComposerOpen(false);
      resetComposer();
      await refetchAll();
    } catch {
      Alert.alert("Save failed", "Could not save this expense. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    amount,
    category,
    createExpense,
    description,
    editingId,
    entryType,
    expenseDate,
    getToken,
    linkDrafts,
    miles,
    receiptAsset,
    refetchAll,
    reportId,
    resetComposer,
    updateExpense,
  ]);

  const handleDelete = useCallback(
    (e: Expense) => {
      Alert.alert("Delete expense", "This draft expense will be permanently removed.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusyId(e.id);
            try {
              await deleteExpense.mutateAsync({ id: e.id });
              await refetchAll();
            } catch {
              Alert.alert("Delete failed", "Could not delete this expense.");
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [deleteExpense, refetchAll],
  );

  const handleDeleteReport = useCallback(
    (r: ExpenseReport) => {
      Alert.alert(
        "Delete report",
        `Delete "${r.title}"? Its expense lines are kept and become standalone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteReport.mutateAsync({ id: r.id });
                await refetchAll();
              } catch {
                Alert.alert("Delete failed", "Could not delete this report.");
              }
            },
          },
        ],
      );
    },
    [deleteReport, refetchAll],
  );

  const openEditReport = useCallback((r: ExpenseReport) => {
    setEditingReport(r);
    setReportComposerOpen(true);
  }, []);

  const handleTransition = useCallback(
    async (e: Expense, action: "submit" | "withdraw") => {
      setBusyId(e.id);
      try {
        await transitionExpense.mutateAsync({ id: e.id, data: { action } });
        await refetchAll();
      } catch {
        Alert.alert("Action failed", `Could not ${action} this expense.`);
      } finally {
        setBusyId(null);
      }
    },
    [refetchAll, transitionExpense],
  );

  const renderCard = (item: Expense) => (
    <ExpenseCard
      key={item.id}
      expense={item}
      busy={busyId === item.id}
      authToken={authToken}
      onSubmit={(e) => handleTransition(e, "submit")}
      onWithdraw={(e) => handleTransition(e, "withdraw")}
      onEdit={openEditor}
      onDelete={handleDelete}
      onViewReceipt={setViewingReceipt}
    />
  );

  const nothingYet = !isLoading && rows.length === 0 && reportList.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "My Expenses" }} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Expenses</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => setReportComposerOpen(true)} hitSlop={10}>
            <Feather name="folder-plus" size={22} color={colors.primary} />
          </Pressable>
          <Pressable onPress={openAdd} hitSlop={10}>
            <Feather name="plus" size={24} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : nothingYet ? (
        <View style={styles.center}>
          <EmptyState
            icon="credit-card"
            title="No expenses yet"
            subtitle="Tap + to log an expense, or create a report to group several."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching || isRefetchingReports}
              onRefresh={refetchAll}
              tintColor={colors.primary}
            />
          }
        >
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Pending</Text>
              <Text style={[styles.summaryValue, { color: "#b45309" }]}>
                {formatCents(totals.pending)}
              </Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Reimbursed</Text>
              <Text style={[styles.summaryValue, { color: "#15803d" }]}>
                {formatCents(totals.reimbursed)}
              </Text>
            </View>
          </View>

          {reportList.map((r) => {
            const lines = linesByReport.get(r.id) ?? [];
            const reportTotal = lines.reduce((s, l) => s + l.amountCents, 0);
            const sharedNames = reportLinkNames(r);
            return (
              <View
                key={r.id}
                style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.reportHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.cardTitleRow}>
                      <Feather name="folder" size={15} color={colors.mutedForeground} />
                      <Text style={[styles.reportTitle, { color: colors.foreground }]} numberOfLines={1}>
                        {r.title}
                      </Text>
                    </View>
                    <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
                      {lines.length} {lines.length === 1 ? "line" : "lines"} ·{" "}
                      {formatCents(reportTotal)}
                    </Text>
                  </View>
                  <View style={styles.reportHeaderActions}>
                    <Pressable onPress={() => openEditReport(r)} hitSlop={10}>
                      <Feather name="edit-2" size={17} color={colors.foreground} />
                    </Pressable>
                    <Pressable onPress={() => handleDeleteReport(r)} hitSlop={10}>
                      <Feather name="trash-2" size={18} color={colors.destructive} />
                    </Pressable>
                  </View>
                </View>

                {r.note ? (
                  <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>{r.note}</Text>
                ) : null}

                {sharedNames.length > 0 ? (
                  <View style={styles.cardMetaRow}>
                    <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>Shared:</Text>
                    {sharedNames.map((name) => (
                      <View key={name} style={styles.metaChip}>
                        <Feather name="link" size={11} color={colors.mutedForeground} />
                        <Text
                          style={[styles.metaChipText, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.reportLines}>
                  {lines.length === 0 ? (
                    <Text style={[styles.emptyLines, { color: colors.mutedForeground }]}>
                      No lines in this report yet.
                    </Text>
                  ) : (
                    lines.map(renderCard)
                  )}
                </View>
              </View>
            );
          })}

          {reportList.length > 0 ? (
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              Standalone expenses
            </Text>
          ) : null}
          {standalone.length === 0 && reportList.length > 0 ? (
            <Text style={[styles.emptyLines, { color: colors.mutedForeground, marginBottom: 12 }]}>
              No standalone expenses.
            </Text>
          ) : (
            standalone.map(renderCard)
          )}
        </ScrollView>
      )}

      {/* Single-expense composer (standalone create + per-line edit) */}
      <Modal visible={composerOpen} animationType="slide" onRequestClose={() => setComposerOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setComposerOpen(false)} hitSlop={10}>
                <Feather name="x" size={24} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                {editingId != null ? "Edit Expense" : "New Expense"}
              </Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.segment, { borderColor: colors.border }]}>
                {(["general", "mileage"] as const).map((type) => {
                  const active = entryType === type;
                  return (
                    <Pressable
                      key={type}
                      style={[styles.segmentBtn, active ? { backgroundColor: colors.primary } : null]}
                      onPress={() => setEntryType(type)}
                    >
                      <Feather
                        name={type === "mileage" ? "navigation" : "credit-card"}
                        size={14}
                        color={active ? colors.primaryForeground : colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.segmentText,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {type === "mileage" ? "Mileage" : "General"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                style={[styles.scanBtn, { borderColor: colors.primary, backgroundColor: colors.card }]}
                disabled={scanning}
                onPress={handleScanReceipt}
              >
                {scanning ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <>
                    <Feather name="camera" size={16} color={colors.primary} />
                    <Text style={[styles.scanBtnText, { color: colors.primary }]}>
                      Scan receipt to auto-fill
                    </Text>
                  </>
                )}
              </Pressable>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                value={expenseDate}
                onChangeText={setExpenseDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
              />

              {entryType === "general" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
                  <CategoryField value={category} onChange={setCategory} />
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Amount (USD)</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="0.00"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="decimal-pad"
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Miles</Text>
                  <TextInput
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                    value={miles}
                    onChangeText={setMiles}
                    placeholder="0"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="decimal-pad"
                  />
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    Reimbursement is calculated from your miles at the current rate when you submit.
                  </Text>
                </>
              )}

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.inputMultiline,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder="Optional description"
                placeholderTextColor={colors.mutedForeground}
                multiline
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Link to (optional)</Text>
              <ExpenseLinksField
                value={linkDrafts}
                onChange={setLinkDrafts}
                pickerTitle="Link expense to"
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Report (optional)</Text>
              <Pressable
                style={[styles.linkRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => setReportPickerOpen(true)}
              >
                <Feather name="folder" size={16} color={colors.mutedForeground} />
                <Text
                  style={[
                    styles.linkRowText,
                    { color: selectedReport ? colors.foreground : colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {selectedReport ? selectedReport.title : "No report"}
                </Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Receipt (optional)</Text>
              <Pressable
                style={[styles.linkRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={handleAttachReceipt}
              >
                <Feather name="camera" size={16} color={colors.mutedForeground} />
                <Text
                  style={[
                    styles.linkRowText,
                    { color: receiptAsset || existingReceipt ? colors.foreground : colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {receiptAsset
                    ? "New receipt attached"
                    : existingReceipt
                      ? "Receipt attached — tap to replace"
                      : "Take photo or choose"}
                </Text>
                {receiptAsset || existingReceipt ? (
                  <Pressable
                    onPress={() => {
                      setReceiptAsset(null);
                      setExistingReceipt(false);
                    }}
                    hitSlop={8}
                  >
                    <Feather name="x" size={16} color={colors.mutedForeground} />
                  </Pressable>
                ) : (
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                )}
              </Pressable>
            </ScrollView>

            <View
              style={[
                styles.footer,
                { borderTopColor: colors.border, paddingBottom: insets.bottom + 12, backgroundColor: colors.background },
              ]}
            >
              <Pressable
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
                disabled={saving}
                onPress={handleSave}
              >
                {saving ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                    {editingId != null ? "Save changes" : "Save expense"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ReportComposer
        visible={reportComposerOpen}
        report={editingReport}
        onClose={() => {
          setReportComposerOpen(false);
          setEditingReport(null);
        }}
        onSaved={async () => {
          setReportComposerOpen(false);
          setEditingReport(null);
          await refetchAll();
        }}
        getToken={getToken}
      />

      {/* Report selector for filing a single expense into / out of a report */}
      <Modal
        visible={reportPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReportPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setReportPickerOpen(false)}>
          <Pressable
            style={[
              styles.pickerSheet,
              { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Choose a report</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Pressable
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setReportId(null);
                  setReportPickerOpen(false);
                }}
              >
                <Feather
                  name={reportId == null ? "check-circle" : "circle"}
                  size={18}
                  color={reportId == null ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.pickerRowText, { color: colors.foreground }]}>No report</Text>
              </Pressable>
              {reportList.map((r) => {
                const active = reportId === r.id;
                return (
                  <Pressable
                    key={r.id}
                    style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setReportId(r.id);
                      setReportPickerOpen(false);
                    }}
                  >
                    <Feather
                      name={active ? "check-circle" : "circle"}
                      size={18}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[styles.pickerRowText, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {r.title}
                    </Text>
                  </Pressable>
                );
              })}
              {reportList.length === 0 ? (
                <Text style={[styles.emptyLines, { color: colors.mutedForeground, paddingHorizontal: 4 }]}>
                  You don&apos;t have any reports yet.
                </Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={viewingReceipt !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewingReceipt(null)}
      >
        <View style={styles.receiptViewer}>
          {viewingReceipt !== null ? (
            <Image
              source={{ uri: receiptRawUri(viewingReceipt), headers: authHeaders(authToken) }}
              style={styles.receiptViewerImage}
              contentFit="contain"
              cachePolicy="disk"
            />
          ) : null}
          <Pressable
            style={[styles.receiptViewerClose, { top: insets.top + 12 }]}
            onPress={() => setViewingReceipt(null)}
            hitSlop={10}
          >
            <Feather name="x" size={24} color="#ffffff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ── Report composer ──────────────────────────────────────────────────────────

interface DraftLine {
  key: string;
  entryType: ExpenseEntryType;
  category: string;
  description: string;
  amount: string;
  miles: string;
  expenseDate: string;
  links: LinkDraft[];
  receiptAsset: ImagePicker.ImagePickerAsset | null;
}

let lineSeq = 0;
function newDraftLine(): DraftLine {
  lineSeq += 1;
  return {
    key: `line-${lineSeq}`,
    entryType: "general",
    category: "",
    description: "",
    amount: "",
    miles: "",
    expenseDate: todayISO(),
    links: [],
    receiptAsset: null,
  };
}

function ReportComposer({
  visible,
  report,
  onClose,
  onSaved,
  getToken,
}: {
  visible: boolean;
  report?: ExpenseReport | null;
  onClose: () => void;
  onSaved: () => void;
  getToken: GetToken;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const createReport = useCreateExpenseReport();
  const updateReport = useUpdateExpenseReport();
  const createExpense = useCreateExpense();
  const isEditing = report != null;

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [reportLinks, setReportLinks] = useState<LinkDraft[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([newDraftLine()]);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setTitle("");
    setNote("");
    setReportLinks([]);
    setLines([newDraftLine()]);
  }, []);

  // Sync local state to the target when the modal opens: prefill for an edit,
  // clear for a fresh create.
  useEffect(() => {
    if (!visible) return;
    if (report) {
      setTitle(report.title);
      setNote(report.note ?? "");
      setReportLinks(linksToDrafts(report.links));
      setLines([newDraftLine()]);
    } else {
      reset();
    }
  }, [visible, report, reset]);

  const total = useMemo(
    () =>
      lines.reduce((s, l) => {
        if (l.entryType === "general") {
          const n = Number(l.amount);
          return s + (Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0);
        }
        return s;
      }, 0),
    [lines],
  );

  const patchLine = useCallback(
    (key: string, patch: Partial<DraftLine>) =>
      setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l))),
    [],
  );

  const removeLine = useCallback(
    (key: string) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev)),
    [],
  );

  const attachLineReceipt = useCallback(
    async (key: string) => {
      const asset = await chooseReceiptAsset();
      if (asset) patchLine(key, { receiptAsset: asset });
    },
    [patchLine],
  );

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert("Report title required", "Give this report a name.");
      return;
    }

    // Edit mode only touches the report's own metadata; its lines are managed
    // separately as expense cards. links[] is the complete desired set — the
    // server splits the first into the legacy column.
    if (isEditing && report) {
      setSaving(true);
      try {
        await updateReport.mutateAsync({
          id: report.id,
          data: {
            title: t,
            note: note.trim() || null,
            links: draftsToInputs(reportLinks),
          },
        });
        onSaved();
      } catch {
        Alert.alert("Couldn't save report", "Please try again.");
      } finally {
        setSaving(false);
      }
      return;
    }

    for (const l of lines) {
      if (l.entryType === "general") {
        const n = Number(l.amount);
        if (!Number.isFinite(n) || n <= 0) {
          Alert.alert("Check your lines", "Each general line needs a valid amount.");
          return;
        }
      } else {
        const m = Number(l.miles);
        if (!Number.isFinite(m) || m <= 0) {
          Alert.alert("Check your lines", "Each mileage line needs miles driven.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      const created = await createReport.mutateAsync({
        data: {
          title: t,
          note: note.trim() || null,
          links: draftsToInputs(reportLinks),
        },
      });
      let receiptFailures = 0;
      for (const l of lines) {
        const body: ExpenseInput = {
          entryType: l.entryType,
          expenseDate: l.expenseDate,
          description: l.description.trim() || null,
          reportId: created.id,
          links: draftsToInputs(l.links),
        };
        if (l.entryType === "general") {
          body.category = l.category.trim() || null;
          body.amountCents = Math.round(Number(l.amount) * 100);
        } else {
          body.miles = Number(l.miles);
        }
        const line = await createExpense.mutateAsync({ data: body });
        if (l.receiptAsset && line?.id) {
          try {
            await uploadReceipt(line.id, l.receiptAsset, getToken);
          } catch {
            receiptFailures += 1;
          }
        }
      }
      if (receiptFailures > 0) {
        Alert.alert(
          "Report created",
          `${lines.length} lines saved. ${receiptFailures} receipt(s) failed to upload.`,
        );
      }
      reset();
      onSaved();
    } catch {
      Alert.alert("Couldn't create report", "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    createExpense,
    createReport,
    getToken,
    isEditing,
    lines,
    note,
    onSaved,
    report,
    reportLinks,
    reset,
    title,
    updateReport,
  ]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={close} hitSlop={10}>
              <Feather name="x" size={24} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              {isEditing ? "Edit Report" : "New Report"}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 0, marginBottom: 8 }]}>
              {isEditing
                ? "Update the report's title, note, and shared links. Add or move lines from each expense."
                : "Group several expense & mileage lines together. Shared links apply to the whole report; each line can add its own."}
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Report title</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. March field trip"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Note (optional)</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              value={note}
              onChangeText={setNote}
              placeholder="Optional summary"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Shared links (apply to all lines)
            </Text>
            <ExpenseLinksField value={reportLinks} onChange={setReportLinks} pickerTitle="Add a shared link" />

            {isEditing ? null : (
            <>
            <View style={styles.linesHeader}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 0 }]}>Lines</Text>
              <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 0 }]}>
                General total: {formatCents(total)}
              </Text>
            </View>

            {lines.map((l, idx) => (
              <View
                key={l.key}
                style={[styles.lineCard, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <View style={styles.lineCardHeader}>
                  <View style={[styles.segment, styles.lineSegment, { borderColor: colors.border }]}>
                    {(["general", "mileage"] as const).map((type) => {
                      const active = l.entryType === type;
                      return (
                        <Pressable
                          key={type}
                          style={[styles.segmentBtn, active ? { backgroundColor: colors.primary } : null]}
                          onPress={() => patchLine(l.key, { entryType: type })}
                        >
                          <Feather
                            name={type === "mileage" ? "navigation" : "credit-card"}
                            size={13}
                            color={active ? colors.primaryForeground : colors.mutedForeground}
                          />
                          <Text
                            style={[
                              styles.segmentText,
                              { color: active ? colors.primaryForeground : colors.mutedForeground },
                            ]}
                          >
                            {type === "mileage" ? "Mileage" : "General"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {lines.length > 1 ? (
                    <Pressable onPress={() => removeLine(l.key)} hitSlop={8} style={{ marginLeft: 10 }}>
                      <Feather name="trash-2" size={18} color={colors.destructive} />
                    </Pressable>
                  ) : null}
                </View>

                <Text style={[styles.fieldLabelSm, { color: colors.mutedForeground }]}>Date</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={l.expenseDate}
                  onChangeText={(v) => patchLine(l.key, { expenseDate: v })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                />

                {l.entryType === "general" ? (
                  <>
                    <Text style={[styles.fieldLabelSm, { color: colors.mutedForeground }]}>Category</Text>
                    <CategoryField
                      value={l.category}
                      onChange={(v) => patchLine(l.key, { category: v })}
                    />
                    <Text style={[styles.fieldLabelSm, { color: colors.mutedForeground }]}>Amount (USD)</Text>
                    <TextInput
                      style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={l.amount}
                      onChangeText={(v) => patchLine(l.key, { amount: v })}
                      placeholder="0.00"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                    />
                  </>
                ) : (
                  <>
                    <Text style={[styles.fieldLabelSm, { color: colors.mutedForeground }]}>Miles</Text>
                    <TextInput
                      style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                      value={l.miles}
                      onChangeText={(v) => patchLine(l.key, { miles: v })}
                      placeholder="0"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                    />
                  </>
                )}

                <Text style={[styles.fieldLabelSm, { color: colors.mutedForeground }]}>Notes (optional)</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={l.description}
                  onChangeText={(v) => patchLine(l.key, { description: v })}
                  placeholder="Optional description"
                  placeholderTextColor={colors.mutedForeground}
                />

                <Text style={[styles.fieldLabelSm, { color: colors.mutedForeground }]}>
                  Line links (override, optional)
                </Text>
                <ExpenseLinksField
                  value={l.links}
                  onChange={(next) => patchLine(l.key, { links: next })}
                  pickerTitle="Add a line link"
                  compact
                />

                <Pressable
                  style={[styles.lineReceiptBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => attachLineReceipt(l.key)}
                >
                  <Feather name="camera" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.lineReceiptText, { color: colors.foreground }]}>
                    {l.receiptAsset ? "Receipt attached" : "Attach receipt"}
                  </Text>
                  {l.receiptAsset ? (
                    <Pressable onPress={() => patchLine(l.key, { receiptAsset: null })} hitSlop={8}>
                      <Feather name="x" size={15} color={colors.mutedForeground} />
                    </Pressable>
                  ) : null}
                </Pressable>
              </View>
            ))}

            <Pressable
              style={[styles.addLineBtn, { borderColor: colors.border }]}
              onPress={() => setLines((prev) => [...prev, newDraftLine()])}
            >
              <Feather name="plus" size={16} color={colors.primary} />
              <Text style={[styles.addLineText, { color: colors.primary }]}>Add line</Text>
            </Pressable>
            </>
            )}
          </ScrollView>

          <View
            style={[
              styles.footer,
              { borderTopColor: colors.border, paddingBottom: insets.bottom + 12, backgroundColor: colors.background },
            ]}
          >
            <Pressable
              style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              disabled={saving}
              onPress={handleSave}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                  {isEditing ? "Save changes" : "Create report"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  summaryRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  summaryCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14 },
  summaryLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  summaryValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4, marginBottom: 10 },
  reportCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 },
  reportHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  reportHeaderActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  reportTitle: { fontSize: 16, fontFamily: "Inter_700Bold", flexShrink: 1 },
  reportLines: { marginTop: 12 },
  emptyLines: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  cardDate: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  amount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 10 },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "60%" },
  metaChipText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  receiptRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  receiptThumb: { width: 48, height: 48, borderRadius: 8, borderWidth: 1 },
  receiptLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  receiptViewer: { flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  receiptViewerImage: { width: "100%", height: "100%" },
  receiptViewerClose: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  rejection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  rejectionText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 14,
  },
  actionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionBtnFlex: { flex: 1, marginTop: 0 },
  actionBtnOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    marginTop: 14,
  },
  actionBtnOutlineText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  segment: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 4,
    gap: 4,
    marginBottom: 8,
  },
  lineSegment: { flex: 1, marginBottom: 0 },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  segmentText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  scanBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 16, marginBottom: 6 },
  fieldLabelSm: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 10 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  linkRowText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  linesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 4,
  },
  lineCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  lineCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lineReceiptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 12,
  },
  lineReceiptText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  addLineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 4,
  },
  addLineText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  pickerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  pickerSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  pickerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 8 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  pickerRowText: { fontSize: 15, fontFamily: "Inter_500Medium", flex: 1 },
});

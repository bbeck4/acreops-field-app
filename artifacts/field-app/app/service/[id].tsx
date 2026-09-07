import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetWorkItem,
  useListServiceChecklistTemplates,
  useListProducts,
  useListSites,
  useListInventory,
  useCompleteServiceJob,
  useStampJobEnRoute,
  useStampJobOnSite,
  useStartServiceJobLabor,
  useStopServiceJobLabor,
  useUpdateServiceJob,
  useUpdateServiceJobParts,
  getGetWorkItemQueryKey,
  getListWorkItemsQueryKey,
  getListInventoryQueryKey,
  getServiceJobReportLink,
  type CompleteServiceJobInput,
  type ServiceJobPartsInput,
  type WorkItemLaborEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { CustomerContextPanel } from "@/components/CustomerContextPanel";
import { MediaGallery } from "@/components/MediaGallery";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useOffline } from "@/context/OfflineContext";
import { canNavigate, openNavigation } from "@/lib/navigation";
import { usePermissions } from "@/lib/permissions";
import { useColors } from "@/hooks/useColors";

// Service-job day-runner. Drives the tech through the four-phase state
// machine (Open → En route → On site → Complete) and captures everything
// the rep/dispatcher needs on the customer's report: per-segment labor,
// mileage, parts, photos, signature, follow-up. Every write is queued via
// useOffline.queueWrite so a tech in a dead zone can keep tapping through.
type Checklist = { label: string; checked: boolean; note?: string }[];

// Optimistic shadow used to keep the labor timer responsive offline. On
// "start" we push a `start` op with a temporary id; on "stop" we push a
// `stop` op referring to either a temp id or a server id. We never mutate
// `job.laborEntries` directly — display = applyOps(job.laborEntries, ops).
//
// Reconciliation is by `queueId` (the OfflineContext queue write id), NOT
// by timestamp: the server stamps its own startedAt, so timestamp equality
// is unreliable. When the matching pending write disappears from the
// offline queue (i.e. successfully flushed), we drop the optimistic op
// and let the next refetch reveal the real server entry.
type LaborOp =
  | { kind: "start"; tmpId: string; queueId: string; startedAt: string; taskLabel: string | null }
  | { kind: "stop"; queueId: string; refTmpId?: string; refServerId?: number; endedAt: string };

const ODO_KEY = (jobId: number) => `@agriops:svcjob_odo_start:${jobId}`;
const OPS_KEY = (jobId: number) => `@agriops:svcjob_labor_ops:${jobId}`;

const TASK_LABELS = ["diagnosis", "parts swap", "training", "travel"];

function applyOps(server: WorkItemLaborEntry[], ops: LaborOp[]): WorkItemLaborEntry[] {
  // Clone server entries so we can flip endedAt for optimistic stops without
  // mutating the react-query cache.
  const merged: WorkItemLaborEntry[] = server.map((e) => ({ ...e }));
  // Map of tmpId → entry index for stops that target queued starts.
  const tmpIndex = new Map<string, number>();
  for (const op of ops) {
    if (op.kind === "start") {
      const synthetic: WorkItemLaborEntry = {
        id: -Date.now() - merged.length, // negative so it can't collide with server ids
        workItemId: 0,
        memberId: null,
        memberName: null,
        startedAt: op.startedAt,
        endedAt: null,
        minutes: null,
        taskLabel: op.taskLabel,
        createdAt: op.startedAt,
      };
      tmpIndex.set(op.tmpId, merged.length);
      merged.push(synthetic);
    } else {
      const target =
        op.refServerId != null
          ? merged.findIndex((e) => e.id === op.refServerId)
          : op.refTmpId != null && tmpIndex.has(op.refTmpId)
            ? tmpIndex.get(op.refTmpId)!
            : -1;
      if (target >= 0 && !merged[target].endedAt) {
        const startMs = new Date(merged[target].startedAt).getTime();
        const endMs = new Date(op.endedAt).getTime();
        merged[target] = {
          ...merged[target],
          endedAt: op.endedAt,
          minutes: Math.max(0, Math.round((endMs - startMs) / 60_000)),
        };
      }
    }
  }
  return merged;
}

function totalMinutes(entries: WorkItemLaborEntry[]): number {
  return entries.reduce((sum, e) => {
    if (typeof e.minutes === "number") return sum + e.minutes;
    if (!e.endedAt) {
      // running — include live elapsed
      const ms = Date.now() - new Date(e.startedAt).getTime();
      return sum + Math.max(0, Math.round(ms / 60_000));
    }
    return sum;
  }, 0);
}

export default function ServiceJobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const workItemId = parseInt(id ?? "0", 10);
  const { isOnline, queueWrite, triggerFlush, pendingWrites } = useOffline();

  const { data: job, isLoading, refetch } = useGetWorkItem(workItemId, {
    query: { enabled: !!workItemId, queryKey: getGetWorkItemQueryKey(workItemId) },
  });
  const { data: templates } = useListServiceChecklistTemplates();
  const { data: products } = useListProducts();
  const { data: sites } = useListSites({ inventoryOnly: true });
  const truckSites = useMemo(
    () => (sites ?? []).filter((site) => site.type.trim().toLowerCase() === "truck"),
    [sites],
  );
  const completeMutation = useCompleteServiceJob();
  const enRouteMutation = useStampJobEnRoute();
  const onSiteMutation = useStampJobOnSite();
  const startLaborMutation = useStartServiceJobLabor();
  const stopLaborMutation = useStopServiceJobLabor();
  const updateJobMutation = useUpdateServiceJob();
  const updatePartsMutation = useUpdateServiceJobParts();
  const queryClient = useQueryClient();
  const { canDo } = usePermissions();
  const canEdit = canDo("service.edit");

  // Per-job persisted state: the starting odometer the tech enters when
  // tapping "Start trip" and the local labor ops we haven't yet synced.
  const [startOdometer, setStartOdometer] = useState<string>("");
  const [laborOps, setLaborOps] = useState<LaborOp[]>([]);
  const [opsLoaded, setOpsLoaded] = useState(false);

  const [checklist, setChecklist] = useState<Checklist>([]);
  const [signature, setSignature] = useState<string>("");
  const [signerName, setSignerName] = useState<string>("");
  const [parts, setParts] = useState<{ productId: number; productName: string; quantity: number }[]>([]);
  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [partFilter, setPartFilter] = useState("");
  const [truckSiteId, setTruckSiteId] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [followUpReason, setFollowUpReason] = useState("");
  const [nextServiceDue, setNextServiceDue] = useState("");
  const [endOdometer, setEndOdometer] = useState("");
  const [mileageMilesInput, setMileageMilesInput] = useState("");
  const [newSegLabel, setNewSegLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reschedule editor (tech-driven). Pre-filled from the current scheduled
  // window when expanded so a small tweak doesn't require retyping the
  // whole start/end. Format YYYY-MM-DD HH:MM (local) for both fields.
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleEnd, setRescheduleEnd] = useState("");
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Progressive parts: we hydrate the picker from whatever's already on the
  // job once, then let the tech save at any point (not just on completion).
  const [partsHydrated, setPartsHydrated] = useState(false);
  const [savingParts, setSavingParts] = useState(false);
  const [partsDirty, setPartsDirty] = useState(false);

  // Quick-action bottom sheet + scroll targets so a tap can jump the tech to
  // the relevant section.
  const [quickOpen, setQuickOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const partsSectionY = useRef(0);
  const mediaSectionY = useRef(0);

  // Truck-site inventory so the tech can see on-hand counts inline while
  // logging parts. Only fetched once a truck site is selected.
  const { data: truckInventory } = useListInventory(
    { siteId: truckSiteId },
    {
      query: {
        enabled: truckSiteId != null,
        queryKey: getListInventoryQueryKey({ siteId: truckSiteId }),
      },
    },
  );
  const onHandByProduct = useMemo(() => {
    const m = new Map<number, number>();
    for (const lvl of truckInventory ?? []) m.set(lvl.productId, lvl.quantityOnHand);
    return m;
  }, [truckInventory]);

  // Tick once per minute so the running labor segment + total update live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Load persisted odometer + queued labor ops for this job once.
  useEffect(() => {
    if (!workItemId) return;
    AsyncStorage.getItem(ODO_KEY(workItemId)).then((v) => {
      if (v != null) setStartOdometer(v);
    });
    AsyncStorage.getItem(OPS_KEY(workItemId)).then((raw) => {
      if (raw) {
        try {
          setLaborOps(JSON.parse(raw));
        } catch {
          // corrupt cache; ignore
        }
      }
      setOpsLoaded(true);
    });
  }, [workItemId]);

  const matchedTemplate = useMemo(
    () => templates?.find((t) => t.kind === job?.kind) ?? templates?.[0],
    [templates, job?.kind],
  );

  useEffect(() => {
    if (matchedTemplate && checklist.length === 0) {
      setChecklist(matchedTemplate.items.map((label) => ({ label, checked: false })));
    }
  }, [matchedTemplate, checklist.length]);

  // Hydrate the parts picker once from whatever is already persisted on the
  // job (data.partsUsed). After this, local edits are the source of truth.
  useEffect(() => {
    if (partsHydrated || !job) return;
    const raw = (job.data as { partsUsed?: unknown } | null)?.partsUsed;
    if (Array.isArray(raw)) {
      const restored = raw
        .map((p) => p as { productId?: unknown; productName?: unknown; quantity?: unknown })
        .filter((p) => typeof p.productId === "number")
        .map((p) => ({
          productId: p.productId as number,
          productName: typeof p.productName === "string" ? p.productName : "Part",
          quantity: typeof p.quantity === "number" && p.quantity > 0 ? p.quantity : 1,
        }));
      if (restored.length > 0) setParts(restored);
    }
    setPartsHydrated(true);
  }, [job, partsHydrated]);

  // Reconcile optimistic ops by queueId: any op whose queue write has been
  // flushed (i.e. is no longer in pendingWrites) is dropped, and a refetch
  // is requested so the real server entry shows up. This is reliable
  // regardless of timestamp drift between client and server.
  useEffect(() => {
    if (!opsLoaded || laborOps.length === 0) return;
    const pendingIds = new Set(pendingWrites.map((w) => w.id));
    const filtered = laborOps.filter((op) => pendingIds.has(op.queueId));
    if (filtered.length !== laborOps.length) {
      setLaborOps(filtered);
      AsyncStorage.setItem(OPS_KEY(workItemId), JSON.stringify(filtered)).catch(() => {});
      // Pull the freshly-flushed entries so the server view replaces the op.
      refetch();
    }
  }, [pendingWrites, opsLoaded, laborOps, workItemId, refetch]);

  const persistOps = (next: LaborOp[]) => {
    setLaborOps(next);
    AsyncStorage.setItem(OPS_KEY(workItemId), JSON.stringify(next)).catch(() => {});
  };

  const displayEntries = useMemo(
    () => (job ? applyOps(job.laborEntries ?? [], laborOps) : []),
    [job, laborOps],
  );
  const runningEntry = displayEntries.find((e) => !e.endedAt) ?? null;
  const totalMins = totalMinutes(displayEntries);

  // ── State-machine actions ────────────────────────────────────────────────

  const onStartTrip = async () => {
    if (!job) return;
    // Persist starting odometer locally so we can compute mileage on completion
    // even after a reload. Empty string means the tech skipped it.
    if (startOdometer.trim()) {
      await AsyncStorage.setItem(ODO_KEY(workItemId), startOdometer.trim());
    } else {
      // Tech cleared the field before starting — drop any stale value left
      // from a previous attempt so completion mileage doesn't pick it up.
      await AsyncStorage.removeItem(ODO_KEY(workItemId));
    }
    try {
      if (isOnline) {
        await enRouteMutation.mutateAsync({ id: workItemId, data: {} });
        refetch();
      } else {
        await queueWrite("serviceJobEnRoute", { workItemId, data: {} });
        triggerFlush();
      }
    } catch (e) {
      Alert.alert("Couldn't start trip", e instanceof Error ? e.message : "Try again.");
    }
  };

  const onArrived = async () => {
    if (!job) return;
    try {
      if (isOnline) {
        // Online path: no optimistic shadowing — refetch resolves the truth.
        // Roll back nothing on failure because we never mutated local state.
        await onSiteMutation.mutateAsync({ id: workItemId, data: {} });
        await startLaborMutation.mutateAsync({ id: workItemId, data: { taskLabel: null } });
        refetch();
      } else {
        await queueWrite("serviceJobOnSite", { workItemId, data: {} });
        // Auto-start a default labor segment on arrival per spec, with an
        // optimistic op tied to its queueId so the timer card lights up.
        const queueId = await queueWrite("serviceLaborStart", {
          workItemId,
          data: { taskLabel: null },
        });
        const tmpId = `tmp-${Date.now()}`;
        persistOps([
          ...laborOps,
          {
            kind: "start",
            tmpId,
            queueId,
            startedAt: new Date().toISOString(),
            taskLabel: null,
          },
        ]);
        triggerFlush();
      }
    } catch (e) {
      Alert.alert("Couldn't mark on-site", e instanceof Error ? e.message : "Try again.");
    }
  };

  const startSegment = async (label: string | null) => {
    if (!job) return;
    const taskLabel = label && label.trim() ? label.trim() : null;
    setNewSegLabel("");

    if (isOnline) {
      // No optimistic shadowing online — server enforces the auto-stop and
      // a refetch shows both the stopped entry and the new running one. If
      // the mutation fails, local state is unchanged, so nothing to roll back.
      try {
        await startLaborMutation.mutateAsync({ id: workItemId, data: { taskLabel } });
        refetch();
      } catch (e) {
        Alert.alert("Couldn't start segment", e instanceof Error ? e.message : "Try again.");
      }
      return;
    }

    // Offline: queue the start, push optimistic stop on the running entry,
    // then optimistic start. Both ops carry their own queueId so the
    // reconciliation effect can clear them once the writes flush.
    const now = new Date().toISOString();
    const ops: LaborOp[] = [...laborOps];
    if (runningEntry) {
      // Server-side `startServiceJobLabor` auto-stops the previous running
      // entry, so we don't need to enqueue a separate stop write — but we
      // do want the UI to reflect the stop immediately. We tie the
      // optimistic stop to the start's queueId so it goes away in lockstep.
      const startQueueId = await queueWrite("serviceLaborStart", {
        workItemId,
        data: { taskLabel },
      });
      if (runningEntry.id < 0) {
        const startOp = [...ops].reverse().find(
          (o): o is Extract<LaborOp, { kind: "start" }> =>
            o.kind === "start" && o.startedAt === runningEntry.startedAt,
        );
        if (startOp) {
          ops.push({ kind: "stop", queueId: startQueueId, refTmpId: startOp.tmpId, endedAt: now });
        }
      } else {
        ops.push({ kind: "stop", queueId: startQueueId, refServerId: runningEntry.id, endedAt: now });
      }
      const tmpId = `tmp-${Date.now()}`;
      ops.push({ kind: "start", tmpId, queueId: startQueueId, startedAt: now, taskLabel });
    } else {
      const queueId = await queueWrite("serviceLaborStart", { workItemId, data: { taskLabel } });
      const tmpId = `tmp-${Date.now()}`;
      ops.push({ kind: "start", tmpId, queueId, startedAt: now, taskLabel });
    }
    persistOps(ops);
    triggerFlush();
  };

  const stopSegment = async (entry: WorkItemLaborEntry) => {
    if (!job) return;
    const now = new Date().toISOString();

    if (entry.id < 0) {
      // Stop a local-only start whose serviceLaborStart write is still in
      // the offline queue. We can't send a server-side stop yet because no
      // server entry exists, so we enqueue a paired
      // `serviceLaborStopForQueuedStart` write referencing the start's
      // queue id. When the queue flushes, the start runs first and writes
      // its server entry id into a persistent map; the paired stop reads
      // that id and calls the real stop endpoint. This guarantees the
      // server eventually ends up with a stopped segment matching the UI.
      const startOp = [...laborOps].reverse().find(
        (o): o is Extract<LaborOp, { kind: "start" }> =>
          o.kind === "start" && o.startedAt === entry.startedAt,
      );
      if (!startOp) return;
      const stopQueueId = await queueWrite(
        "serviceLaborStopForQueuedStart",
        {
          workItemId,
          startQueueId: startOp.queueId,
          endedAt: now,
        },
        { dependsOn: startOp.queueId },
      );
      persistOps([
        ...laborOps,
        { kind: "stop", queueId: stopQueueId, refTmpId: startOp.tmpId, endedAt: now },
      ]);
      triggerFlush();
      return;
    }

    if (isOnline) {
      try {
        await stopLaborMutation.mutateAsync({ id: workItemId, entryId: entry.id });
        refetch();
      } catch (e) {
        Alert.alert("Couldn't stop segment", e instanceof Error ? e.message : "Try again.");
      }
      return;
    }

    const queueId = await queueWrite("serviceLaborStop", { workItemId, entryId: entry.id });
    persistOps([...laborOps, { kind: "stop", queueId, refServerId: entry.id, endedAt: now }]);
    triggerFlush();
  };

  // ── Reschedule ──────────────────────────────────────────────────────────

  // Format a Date (or ISO) as "YYYY-MM-DD HH:MM" in local time. We avoid
  // toISOString because that snaps to UTC, which would confuse a tech who
  // expects to edit local clock times.
  const fmtLocalInput = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Parse "YYYY-MM-DD HH:MM" (local) → ISO string, or null on bad input.
  // Accepts either a space or "T" between date and time so the tech can
  // paste in either shape without us having to be picky.
  const parseLocalInput = (input: string): string | null => {
    const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
    if (!m) return null;
    const [, y, mo, da, hh, mm] = m;
    const d = new Date(
      Number(y), Number(mo) - 1, Number(da), Number(hh), Number(mm), 0, 0,
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const openReschedule = () => {
    setRescheduleStart(fmtLocalInput(job?.scheduledWindowStart ?? null));
    setRescheduleEnd(fmtLocalInput(job?.scheduledWindowEnd ?? null));
    setRescheduleOpen(true);
  };

  const onSaveReschedule = async () => {
    if (!job) return;
    const startIso = parseLocalInput(rescheduleStart);
    const endIso = parseLocalInput(rescheduleEnd);
    if (!startIso || !endIso) {
      Alert.alert("Check the times", "Use the format 2026-05-26 14:30 for both start and end.");
      return;
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      Alert.alert("Check the times", "End must be after start.");
      return;
    }
    setIsRescheduling(true);
    const data = { scheduledWindowStart: startIso, scheduledWindowEnd: endIso };
    try {
      if (isOnline) {
        await updateJobMutation.mutateAsync({ id: workItemId, data });
        // My-day list and any other work-item lists need to reorder.
        queryClient.invalidateQueries({ queryKey: getListWorkItemsQueryKey(), exact: false });
        refetch();
      } else {
        await queueWrite("serviceJobUpdate", { workItemId, data });
        triggerFlush();
      }
      setRescheduleOpen(false);
    } catch (e) {
      Alert.alert("Couldn't reschedule", e instanceof Error ? e.message : "Try again.");
    } finally {
      setIsRescheduling(false);
    }
  };

  // ── Parts ─────────────────────────────────────────────────────────────────

  // All local edits to the parts list flow through here so we can mark the
  // list dirty (enables the Save button) in one place.
  type Part = { productId: number; productName: string; quantity: number };
  const editParts = (updater: (arr: Part[]) => Part[]) => {
    setParts((arr) => updater(arr));
    setPartsDirty(true);
  };

  // Persist parts at any point in the visit (progressive logging). Online →
  // PATCH; offline → queue so it syncs later. No inventory deduction here;
  // that still happens on completion.
  const savePartsNow = async () => {
    if (!job) return;
    setSavingParts(true);
    const data: ServiceJobPartsInput = {
      partsUsed: parts.map((p) => ({
        productId: p.productId,
        productName: p.productName,
        quantity: p.quantity,
      })),
    };
    try {
      if (isOnline) {
        await updatePartsMutation.mutateAsync({ id: workItemId, data });
        refetch();
      } else {
        await queueWrite("serviceJobPartsUpdate", { workItemId, data });
        triggerFlush();
      }
      setPartsDirty(false);
    } catch (e) {
      Alert.alert("Couldn't save parts", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSavingParts(false);
    }
  };

  // ── Completion ───────────────────────────────────────────────────────────

  const computedMileage = useMemo<number | null>(() => {
    // Prefer ending-odometer minus starting-odometer; fall back to single
    // miles input. Empty / invalid → null (skip mileage).
    const start = parseFloat(startOdometer);
    const end = parseFloat(endOdometer);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return Math.round((end - start) * 10) / 10;
    }
    const m = parseFloat(mileageMilesInput);
    if (Number.isFinite(m) && m >= 0) return Math.round(m * 10) / 10;
    return null;
  }, [startOdometer, endOdometer, mileageMilesInput]);

  const onComplete = async () => {
    if (!job) return;
    if (followUp && !followUpReason.trim()) {
      Alert.alert("Reason needed", "Add a quick note for the rep follow-up.");
      return;
    }
    setIsSubmitting(true);
    const payload: CompleteServiceJobInput = {
      // Server auto-stops any running labor entry; we send the auto-tracked
      // total so the report number matches what the tech saw on screen, even
      // if the running segment hasn't been individually stopped yet.
      timeOnSiteMinutes: totalMins > 0 ? totalMins : null,
      partsUsed: parts.map((p) => ({ productId: p.productId, productName: p.productName, quantity: p.quantity })),
      // Photos/videos now upload directly to media-attachments keyed by this
      // work item, so the completion payload no longer carries local URIs.
      photoUrls: [],
      signatureUrl: signature || null,
      signerName: signerName || null,
      checklistResults: checklist.map((c) => ({ label: c.label, checked: c.checked, note: c.note ?? null })),
      truckSiteId: truckSiteId ?? null,
      repFollowUp: followUp,
      repFollowUpReason: followUp ? followUpReason : null,
      nextServiceDue: nextServiceDue || null,
      notes: notes || null,
      mileageMiles: computedMileage,
    };
    try {
      let stockWarnings: string[] = [];
      if (isOnline) {
        const result = await completeMutation.mutateAsync({ id: workItemId, data: payload });
        const w = (result?.data as { partsDeductionWarnings?: unknown } | null)?.partsDeductionWarnings;
        if (Array.isArray(w)) stockWarnings = w.filter((s): s is string => typeof s === "string");
      } else {
        await queueWrite("serviceJobComplete", { workItemId, data: payload });
        triggerFlush();
      }
      // Clean the per-job local state once it's safely queued/sent.
      AsyncStorage.removeItem(ODO_KEY(workItemId)).catch(() => {});
      AsyncStorage.removeItem(OPS_KEY(workItemId)).catch(() => {});
      const completeMsg = isOnline ? "Sent up." : "Saved locally and will sync when you're back online.";
      // Surface any truck-stock shortfalls so the tech knows a count is off and
      // dispatch/warehouse should reconcile (stock was clamped at zero, not
      // driven negative).
      const msg = stockWarnings.length
        ? `${completeMsg}\n\nHeads up — truck stock didn't cover every part:\n• ${stockWarnings.join("\n• ")}`
        : completeMsg;
      Alert.alert("Job complete", msg, [
        { text: "OK", onPress: () => router.replace("/service" as never) },
      ]);
    } catch (e) {
      Alert.alert("Could not complete", e instanceof Error ? e.message : "Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12,
    },
    back: { padding: 4 },
    title: { fontSize: 18, fontWeight: "700", color: colors.foreground, flex: 1 },
    section: { paddingHorizontal: 16, paddingTop: 16 },
    sectionTitle: { fontSize: 13, fontWeight: "600", color: colors.mutedForeground, textTransform: "uppercase", marginBottom: 8 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
    bodyText: { fontSize: 14, color: colors.foreground, lineHeight: 20 },
    metaText: { fontSize: 12, color: colors.mutedForeground, marginTop: 4 },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    checkRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.foreground, marginTop: 6, backgroundColor: colors.background },
    btn: { backgroundColor: colors.primary, padding: 14, borderRadius: 10, alignItems: "center" },
    btnText: { color: colors.primaryForeground, fontWeight: "700", fontSize: 15 },
    btnGhost: { backgroundColor: colors.muted, padding: 12, borderRadius: 10, alignItems: "center", flex: 1 },
    btnGhostText: { color: colors.foreground, fontWeight: "600" },
    pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    pill: { backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 6 },
    pillText: { fontSize: 12, color: colors.foreground },
    productRow: { padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    phaseBadge: {
      alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 6,
    },
    phaseBadgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    segRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border,
    },
    stopBtn: {
      backgroundColor: colors.destructive, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
    },
    stopBtnText: { color: colors.primaryForeground, fontWeight: "700", fontSize: 12 },
    runningChip: {
      backgroundColor: "#fef3c7", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginRight: 8,
    },
    runningChipText: { color: "#92400e", fontSize: 11, fontWeight: "700" },
    labelChip: {
      backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    },
    labelChipText: { fontSize: 12, color: colors.foreground },
    savePartsBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    },
    savePartsText: { color: colors.primaryForeground, fontWeight: "700", fontSize: 12 },
    stickyTimer: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 10,
      backgroundColor: colors.card,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    timerDot: { width: 10, height: 10, borderRadius: 5 },
    stickyTimerLabel: { fontSize: 14, fontWeight: "700", color: colors.foreground, flexShrink: 1 },
    stickyTimerTotal: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    stickyStopBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.destructive, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    },
    stickyStartBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    },
    stickyBtnText: { color: colors.primaryForeground, fontWeight: "700", fontSize: 13 },
    fab: {
      position: "absolute", right: 20,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.primary, alignItems: "center", justifyContent: "center",
      shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 18, borderTopRightRadius: 18,
      paddingHorizontal: 16, paddingTop: 10,
    },
    sheetHandle: {
      alignSelf: "center", width: 40, height: 4, borderRadius: 2,
      backgroundColor: colors.border, marginBottom: 12,
    },
    sheetTitle: {
      fontSize: 13, fontWeight: "700", color: colors.mutedForeground,
      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
    },
    sheetRow: {
      flexDirection: "row", alignItems: "center", gap: 14,
      paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    sheetRowText: { fontSize: 16, color: colors.foreground, fontWeight: "600" },
  });

  if (isLoading || !job) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const completed = job.status === "completed";
  // Phase derivation. Server-side, both "on_site" and "in_progress" count as
  // the on-site phase (server bumps to in_progress on the on-site stamp, but
  // older rows / future variants may use on_site). Optimistic phase bumps
  // come from pending offline writes for this job: a queued en-route write
  // means we're at least En route, and a queued on-site write means we're
  // at least On site. Without this the UI would stay stuck on Open offline
  // and the tech couldn't reach the labor + completion sections.
  const queuedEnRoute = pendingWrites.some(
    (w) => w.type === "serviceJobEnRoute" &&
      (w.payload as { workItemId?: number } | null)?.workItemId === workItemId,
  );
  const queuedOnSite = pendingWrites.some(
    (w) => w.type === "serviceJobOnSite" &&
      (w.payload as { workItemId?: number } | null)?.workItemId === workItemId,
  );
  const serverPhase: "open" | "en_route" | "on_site" | "completed" = completed
    ? "completed"
    : job.status === "en_route"
      ? "en_route"
      : job.status === "on_site" || job.status === "in_progress"
        ? "on_site"
        : "open";
  const phaseRank = { open: 0, en_route: 1, on_site: 2, completed: 3 } as const;
  const optimisticRank = Math.max(
    phaseRank[serverPhase],
    queuedOnSite ? phaseRank.on_site : phaseRank.open,
    queuedEnRoute ? phaseRank.en_route : phaseRank.open,
  );
  const phase: "open" | "en_route" | "on_site" | "completed" =
    optimisticRank === 3 ? "completed"
    : optimisticRank === 2 ? "on_site"
    : optimisticRank === 1 ? "en_route"
    : "open";

  const phaseColors: Record<typeof phase, { bg: string; fg: string; label: string }> = {
    open: { bg: colors.muted, fg: colors.mutedForeground, label: "Open" },
    en_route: { bg: "#dbeafe", fg: "#1e40af", label: "En route" },
    on_site: { bg: "#dcfce7", fg: "#166534", label: "On site" },
    completed: { bg: colors.muted, fg: colors.mutedForeground, label: "Completed" },
  };

  const filteredProducts = (products ?? []).filter((p) =>
    !partFilter ? true : p.name.toLowerCase().includes(partFilter.toLowerCase()),
  );

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const liveMinutes = (e: WorkItemLaborEntry) =>
    e.endedAt
      ? e.minutes ?? 0
      : Math.max(0, Math.round((Date.now() - new Date(e.startedAt).getTime()) / 60_000));

  return (
    <View style={styles.container}>
      <OfflineBanner />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{job.summary ?? `Job #${job.id}`}</Text>
      </View>
      {/* Sticky live labor timer — always visible while on site so the tech
          can see the clock and stop/switch without scrolling. */}
      {phase === "on_site" && !completed && canEdit && (
        <View style={styles.stickyTimer}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={[
                  styles.timerDot,
                  { backgroundColor: runningEntry ? "#22c55e" : colors.mutedForeground },
                ]}
              />
              <Text style={styles.stickyTimerLabel} numberOfLines={1}>
                {runningEntry
                  ? `${runningEntry.taskLabel ?? "Labor"} · ${liveMinutes(runningEntry)}m`
                  : "Timer paused"}
              </Text>
            </View>
            <Text style={styles.stickyTimerTotal}>{totalMins} min total on site</Text>
          </View>
          {runningEntry ? (
            <Pressable
              style={styles.stickyStopBtn}
              onPress={() => stopSegment(runningEntry)}
              testID="btn-sticky-stop"
            >
              <Feather name="square" size={13} color={colors.primaryForeground} />
              <Text style={styles.stickyBtnText}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.stickyStartBtn}
              onPress={() => startSegment(null)}
              testID="btn-sticky-start"
            >
              <Feather name="play" size={13} color={colors.primaryForeground} />
              <Text style={styles.stickyBtnText}>Start</Text>
            </Pressable>
          )}
        </View>
      )}
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.bodyText}>{job.customerName ?? "—"}</Text>
            <Text style={styles.metaText}>
              {job.kind.replace(/_/g, " ")}
              {job.location ? ` • ${job.location}` : ""}
              {job.dueAt ? ` • due ${new Date(job.dueAt).toLocaleDateString()}` : ""}
            </Text>
            <View style={[styles.phaseBadge, { backgroundColor: phaseColors[phase].bg }]}>
              <Text style={[styles.phaseBadgeText, { color: phaseColors[phase].fg }]}>
                {phaseColors[phase].label}
              </Text>
            </View>

            {canNavigate({ lat: job.customerLat, lng: job.customerLng, address: job.location }) && (
              <Pressable
                style={[styles.btnGhost, { marginTop: 12, flexDirection: "row", justifyContent: "center", gap: 8 }]}
                onPress={() =>
                  void openNavigation({
                    lat: job.customerLat,
                    lng: job.customerLng,
                    address: job.location,
                    label: job.customerName,
                  })
                }
                testID="btn-navigate-job"
              >
                <Feather name="navigation" size={15} color={colors.foreground} />
                <Text style={styles.btnGhostText}>Navigate</Text>
              </Pressable>
            )}

            {/* Phase actions */}
            {phase === "open" && canEdit && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.metaText}>Starting odometer (optional)</Text>
                <TextInput
                  placeholder="e.g. 84210"
                  value={startOdometer}
                  onChangeText={setStartOdometer}
                  keyboardType="numeric"
                  style={styles.input}
                  placeholderTextColor={colors.mutedForeground}
                  testID="input-start-odo"
                />
                <Pressable style={[styles.btn, { marginTop: 12 }]} onPress={onStartTrip} testID="btn-start-trip">
                  <Text style={styles.btnText}>Start trip</Text>
                </Pressable>
              </View>
            )}
            {phase === "en_route" && canEdit && (
              <View style={{ marginTop: 12 }}>
                {job.enRouteAt && (
                  <Text style={styles.metaText}>Trip started {fmtTime(job.enRouteAt)}</Text>
                )}
                <Pressable style={[styles.btn, { marginTop: 8 }]} onPress={onArrived} testID="btn-arrived">
                  <Text style={styles.btnText}>I&apos;ve arrived</Text>
                </Pressable>
              </View>
            )}
            {phase === "on_site" && job.onSiteAt && (
              <Text style={styles.metaText}>On site since {fmtTime(job.onSiteAt)}</Text>
            )}
          </View>
        </View>

        {job.customerId != null && (
          <View style={styles.section}>
            <CustomerContextPanel customerId={job.customerId} />
          </View>
        )}

        {!completed && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scheduled window</Text>
            <View style={styles.card}>
              <Text style={styles.bodyText}>
                {job.scheduledWindowStart || job.scheduledWindowEnd
                  ? `${job.scheduledWindowStart ? new Date(job.scheduledWindowStart).toLocaleString() : "—"} → ${job.scheduledWindowEnd ? new Date(job.scheduledWindowEnd).toLocaleString() : "—"}`
                  : "Not scheduled yet."}
              </Text>
              {!canEdit ? null : !rescheduleOpen ? (
                <Pressable
                  style={[styles.btnGhost, { marginTop: 10 }]}
                  onPress={openReschedule}
                  testID="btn-reschedule-open"
                >
                  <Text style={styles.btnGhostText}>Reschedule</Text>
                </Pressable>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.metaText}>New start (YYYY-MM-DD HH:MM)</Text>
                  <TextInput
                    value={rescheduleStart}
                    onChangeText={setRescheduleStart}
                    placeholder="2026-05-26 14:30"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    placeholderTextColor={colors.mutedForeground}
                    testID="input-reschedule-start"
                  />
                  <Text style={[styles.metaText, { marginTop: 8 }]}>New end (YYYY-MM-DD HH:MM)</Text>
                  <TextInput
                    value={rescheduleEnd}
                    onChangeText={setRescheduleEnd}
                    placeholder="2026-05-26 16:00"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    placeholderTextColor={colors.mutedForeground}
                    testID="input-reschedule-end"
                  />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <Pressable
                      style={styles.btnGhost}
                      onPress={() => setRescheduleOpen(false)}
                      disabled={isRescheduling}
                    >
                      <Text style={styles.btnGhostText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.btn, { flex: 1, opacity: isRescheduling ? 0.6 : 1 }]}
                      onPress={onSaveReschedule}
                      disabled={isRescheduling}
                      testID="btn-reschedule-save"
                    >
                      <Text style={styles.btnText}>
                        {isRescheduling ? "Saving…" : "Save new window"}
                      </Text>
                    </Pressable>
                  </View>
                  {!isOnline && (
                    <Text style={styles.metaText}>
                      You&apos;re offline — the change will sync when you&apos;re back.
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Labor timer card — visible from on-site onward (and after completion as readout) */}
        {(phase === "on_site" || phase === "completed") && (
          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Labor timer</Text>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {totalMins} min total
              </Text>
            </View>
            <View style={styles.card}>
              {displayEntries.length === 0 && (
                <Text style={styles.metaText}>No labor logged yet.</Text>
              )}
              {displayEntries.map((e) => (
                <View key={e.id} style={[styles.segRow, displayEntries[0] === e && { borderTopWidth: 0, paddingTop: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      {!e.endedAt && (
                        <View style={styles.runningChip}>
                          <Text style={styles.runningChipText}>RUNNING</Text>
                        </View>
                      )}
                      <Text style={styles.bodyText}>{e.taskLabel ?? "Labor"}</Text>
                    </View>
                    <Text style={styles.metaText}>
                      {fmtTime(e.startedAt)}
                      {e.endedAt ? ` – ${fmtTime(e.endedAt)}` : " – running"} • {liveMinutes(e)} min
                    </Text>
                  </View>
                  {!e.endedAt && !completed && canEdit && (
                    <Pressable style={styles.stopBtn} onPress={() => stopSegment(e)} testID={`btn-stop-seg-${e.id}`}>
                      <Text style={styles.stopBtnText}>Stop</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {!completed && canEdit && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.metaText}>Start a new segment</Text>
                  <View style={[styles.pillRow, { marginBottom: 6 }]}>
                    {TASK_LABELS.map((label) => (
                      <Pressable
                        key={label}
                        style={[styles.labelChip, newSegLabel === label && { backgroundColor: colors.primary }]}
                        onPress={() => setNewSegLabel(newSegLabel === label ? "" : label)}
                      >
                        <Text style={[styles.labelChipText, newSegLabel === label && { color: colors.primaryForeground }]}>
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    placeholder="Custom label (optional)"
                    value={newSegLabel}
                    onChangeText={setNewSegLabel}
                    style={styles.input}
                    placeholderTextColor={colors.mutedForeground}
                  />
                  <Pressable
                    style={[styles.btn, { marginTop: 8 }]}
                    onPress={() => startSegment(newSegLabel || null)}
                    testID="btn-start-segment"
                  >
                    <Text style={styles.btnText}>
                      {runningEntry ? "Switch to new segment" : "Start segment"}
                    </Text>
                  </Pressable>
                  {runningEntry && (
                    <Text style={styles.metaText}>
                      Starting a new segment automatically stops the running one.
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {!completed && phase === "on_site" && canEdit && checklist.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Checklist {matchedTemplate ? `— ${matchedTemplate.label}` : ""}</Text>
            <View style={styles.card}>
              {checklist.map((item, idx) => (
                <Pressable
                  key={idx}
                  style={styles.checkRow}
                  onPress={() => setChecklist((c) => c.map((x, i) => (i === idx ? { ...x, checked: !x.checked } : x)))}
                  testID={`checklist-${idx}`}
                >
                  <Feather
                    name={item.checked ? "check-square" : "square"}
                    size={20}
                    color={item.checked ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={[styles.bodyText, { flex: 1 }]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!completed && phase === "on_site" && canEdit && (
          <>
            <View
              style={styles.section}
              onLayout={(e) => {
                mediaSectionY.current = e.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.sectionTitle}>Photos & videos</Text>
              <MediaGallery context={{ workItemId }} />
            </View>

            <View
              style={styles.section}
              onLayout={(e) => {
                partsSectionY.current = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>Parts used</Text>
                <Pressable
                  onPress={savePartsNow}
                  disabled={savingParts || !partsDirty}
                  style={[
                    styles.savePartsBtn,
                    (savingParts || !partsDirty) && { opacity: 0.5 },
                  ]}
                  testID="btn-save-parts"
                >
                  <Feather name="save" size={13} color={colors.primaryForeground} />
                  <Text style={styles.savePartsText}>
                    {savingParts ? "Saving…" : partsDirty ? "Save parts" : "Saved"}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.card}>
                {truckSites.length > 0 && (
                  <View>
                    <Text style={styles.metaText}>Truck (deduct from inventory)</Text>
                    <View style={styles.pillRow}>
                      {truckSites.map((s) => (
                        <Pressable
                          key={s.id}
                          onPress={() => setTruckSiteId(truckSiteId === s.id ? undefined : s.id)}
                          style={[styles.pill, truckSiteId === s.id && { backgroundColor: colors.primary }]}
                        >
                          <Text style={[styles.pillText, truckSiteId === s.id && { color: colors.primaryForeground }]}>{s.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
                {parts.length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    {parts.map((p, i) => {
                      const onHand = onHandByProduct.get(p.productId);
                      return (
                        <View key={i} style={[styles.rowBetween, { paddingVertical: 6 }]}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.bodyText} numberOfLines={1}>{p.productName}</Text>
                            {truckSiteId != null && (
                              <Text
                                style={[
                                  styles.metaText,
                                  onHand != null && p.quantity > onHand && { color: colors.destructive },
                                ]}
                              >
                                {onHand != null ? `${onHand} on truck` : "Not stocked on truck"}
                              </Text>
                            )}
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Pressable onPress={() => editParts((arr) => arr.map((x, j) => j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>
                              <Feather name="minus-circle" size={20} color={colors.mutedForeground} />
                            </Pressable>
                            <Text style={styles.bodyText}>{p.quantity}</Text>
                            <Pressable onPress={() => editParts((arr) => arr.map((x, j) => j === i ? { ...x, quantity: x.quantity + 1 } : x))}>
                              <Feather name="plus-circle" size={20} color={colors.mutedForeground} />
                            </Pressable>
                            <Pressable onPress={() => editParts((arr) => arr.filter((_, j) => j !== i))}>
                              <Feather name="x" size={18} color={colors.destructive} />
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
                <Pressable style={[styles.btnGhost, { marginTop: 10 }]} onPress={() => setPartPickerOpen((o) => !o)}>
                  <Text style={styles.btnGhostText}>{partPickerOpen ? "Close picker" : "Add part"}</Text>
                </Pressable>
                {partPickerOpen && (
                  <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <TextInput
                      placeholder="Search products…"
                      value={partFilter}
                      onChangeText={setPartFilter}
                      style={styles.input}
                      placeholderTextColor={colors.mutedForeground}
                    />
                    <ScrollView style={{ maxHeight: 220 }}>
                      {filteredProducts.slice(0, 30).map((p) => {
                        const onHand = onHandByProduct.get(p.id);
                        return (
                          <Pressable
                            key={p.id}
                            style={[styles.productRow, styles.rowBetween]}
                            onPress={() => {
                              editParts((arr) => {
                                const existing = arr.find((x) => x.productId === p.id);
                                if (existing) return arr.map((x) => x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x);
                                return [...arr, { productId: p.id, productName: p.name, quantity: 1 }];
                              });
                            }}
                          >
                            <Text style={[styles.bodyText, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                            {truckSiteId != null && onHand != null && (
                              <Text style={styles.metaText}>{onHand} on truck</Text>
                            )}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Mileage</Text>
              <View style={styles.card}>
                <Text style={styles.metaText}>
                  {startOdometer
                    ? `Started at odometer ${startOdometer}. Enter ending odometer for an auto-computed distance.`
                    : "No starting odometer captured. Enter total miles driven for this trip."}
                </Text>
                {startOdometer ? (
                  <TextInput
                    placeholder="Ending odometer"
                    value={endOdometer}
                    onChangeText={setEndOdometer}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholderTextColor={colors.mutedForeground}
                    testID="input-end-odo"
                  />
                ) : (
                  <TextInput
                    placeholder="Miles driven"
                    value={mileageMilesInput}
                    onChangeText={setMileageMilesInput}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholderTextColor={colors.mutedForeground}
                    testID="input-mileage"
                  />
                )}
                {computedMileage != null && (
                  <Text style={[styles.metaText, { color: colors.foreground }]}>
                    Will record {computedMileage} miles
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Time on site</Text>
              <View style={styles.card}>
                <Text style={styles.bodyText}>{totalMins} minutes</Text>
                <Text style={styles.metaText}>Auto-tracked from labor segments above.</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notes & next visit</Text>
              <View style={styles.card}>
                <TextInput
                  placeholder="Notes for the customer record…"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  style={[styles.input, { minHeight: 70 }]}
                  placeholderTextColor={colors.mutedForeground}
                />
                <TextInput
                  placeholder="Next service due (YYYY-MM-DD)"
                  value={nextServiceDue}
                  onChangeText={setNextServiceDue}
                  style={styles.input}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Customer sign-off</Text>
              <View style={styles.card}>
                <TextInput
                  placeholder="Signer name"
                  value={signerName}
                  onChangeText={setSignerName}
                  style={styles.input}
                  placeholderTextColor={colors.mutedForeground}
                />
                <TextInput
                  placeholder="Signature URL or initials"
                  value={signature}
                  onChangeText={setSignature}
                  style={styles.input}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Rep follow-up</Text>
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.bodyText}>Flag rep to follow up</Text>
                  <Switch value={followUp} onValueChange={setFollowUp} testID="switch-followup" />
                </View>
                {followUp && (
                  <TextInput
                    placeholder="What does the rep need to address?"
                    value={followUpReason}
                    onChangeText={setFollowUpReason}
                    multiline
                    style={[styles.input, { minHeight: 60 }]}
                    placeholderTextColor={colors.mutedForeground}
                  />
                )}
              </View>
            </View>

            <View style={styles.section}>
              <Pressable
                style={[styles.btn, { opacity: isSubmitting ? 0.6 : 1 }]}
                onPress={onComplete}
                disabled={isSubmitting}
                testID="btn-complete"
              >
                <Text style={styles.btnText}>{isSubmitting ? "Submitting…" : "Complete job"}</Text>
              </Pressable>
            </View>
          </>
        )}

        {completed && (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.bodyText}>This job is closed. Open the customer profile in the web app to see the full service history.</Text>
              {job.mileageMiles != null && (
                <Text style={styles.metaText}>Mileage recorded: {job.mileageMiles} miles</Text>
              )}
              <Pressable
                style={[styles.btn, { marginTop: 12 }]}
                onPress={async () => {
                  try {
                    const { url } = await getServiceJobReportLink(job.id);
                    await Linking.openURL(url);
                  } catch (err) {
                    Alert.alert(
                      "Could not open report",
                      err instanceof Error ? err.message : "Try again.",
                    );
                  }
                }}
                testID="btn-view-report"
              >
                <Text style={styles.btnText}>View service report</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Quick-action launcher — floats over the job while on site. */}
      {phase === "on_site" && !completed && canEdit && (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={() => setQuickOpen(true)}
          testID="btn-quick-actions"
        >
          <Feather name="zap" size={22} color={colors.primaryForeground} />
        </Pressable>
      )}

      <Modal
        visible={quickOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setQuickOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setQuickOpen(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Quick actions</Text>

            {runningEntry ? (
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  setQuickOpen(false);
                  stopSegment(runningEntry);
                }}
              >
                <Feather name="square" size={20} color={colors.destructive} />
                <Text style={styles.sheetRowText}>Stop current segment</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  setQuickOpen(false);
                  startSegment(null);
                }}
              >
                <Feather name="play" size={20} color={colors.foreground} />
                <Text style={styles.sheetRowText}>Start labor segment</Text>
              </Pressable>
            )}

            <Pressable
              style={styles.sheetRow}
              onPress={() => {
                setQuickOpen(false);
                setPartPickerOpen(true);
                requestAnimationFrame(() =>
                  scrollRef.current?.scrollTo({ y: partsSectionY.current, animated: true }),
                );
              }}
            >
              <Feather name="package" size={20} color={colors.foreground} />
              <Text style={styles.sheetRowText}>Log a part</Text>
            </Pressable>

            <Pressable
              style={styles.sheetRow}
              onPress={() => {
                setQuickOpen(false);
                requestAnimationFrame(() =>
                  scrollRef.current?.scrollTo({ y: mediaSectionY.current, animated: true }),
                );
              }}
            >
              <Feather name="camera" size={20} color={colors.foreground} />
              <Text style={styles.sheetRowText}>Add photo or video</Text>
            </Pressable>

            <Pressable
              style={[styles.sheetRow, { borderBottomWidth: 0 }]}
              onPress={() => setQuickOpen(false)}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
              <Text style={[styles.sheetRowText, { color: colors.mutedForeground }]}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

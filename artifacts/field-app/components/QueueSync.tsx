import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import {
  addRouteStop,
  assignSampleCode,
  checkInRouteStop,
  claimSampleCode,
  createSamples,
  createSamplingPlan,
  deleteRouteStop,
  generateSamplingGrid,
  getListCustomerActivitiesQueryKey,
  getGetSamplingPlanQueryKey,
  getListFieldSamplingPlansQueryKey,
  getListRoutesQueryKey,
  getListSamplingPlansQueryKey,
  getListWorkItemsQueryKey,
  reassignRouteStops,
  completeServiceJob,
  stampJobEnRoute,
  stampJobOnSite,
  startServiceJobLabor,
  stopServiceJobLabor,
  updateRouteStop,
  updateServiceJob,
  updateServiceJobParts,
} from "@workspace/api-client-react";
import type {
  CompleteServiceJobInput,
  JobMilestoneInput,
  LaborStartInput,
  ServiceJobPartsInput,
  ServiceJobUpdateInput,
} from "@workspace/api-client-react";
import { useCallback, useEffect, useRef } from "react";

import {
  PermanentSyncError,
  useOffline,
  type AddRouteStopPayload,
  type CheckInRouteStopPayload,
  type DeleteRouteStopPayload,
  type PendingWrite,
  type ReassignRouteStopsPayload,
  type UpdateRouteStopPayload,
  type SamplingAddPointPayload,
  type SamplingGridPayload,
  type SamplingPlanPayload,
} from "@/context/OfflineContext";
import { postServicePackageOrder } from "@/lib/servicePackageReplay";
import { replayWorkOrder } from "@/lib/workOrderReplay";
import { classifyAndRethrow, stepKey, withIdempotencyKey } from "@/lib/queueSyncHelpers";

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/** Build RequestInit options that carry the X-Idempotency-Key header. */
function idempotentOpts(writeId: string): RequestInit {
  return withIdempotencyKey(writeId);
}

function malformedPayload(type: string): never {
  throw new PermanentSyncError(`${type} payload is malformed — review or discard this pending write`);
}

function isNonRetryableClientError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: number }).status;
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

// ---------------------------------------------------------------------------
// Raw-fetch helpers
// ---------------------------------------------------------------------------

async function postActivity(
  payload: unknown,
  token: string,
  writeId: string,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured — cannot replay activity",
    );
  }
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") {
    throw new PermanentSyncError(
      "activity payload is missing or not an object — cannot replay",
    );
  }
  const res = await fetch(`https://${domain}/api/activities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": writeId,
    },
    body: JSON.stringify(p),
  });
  if (!res.ok) {
    let msg = `Activity rejected by server (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // non-JSON body; keep default message
    }
    // Classify using the shared helper: 4xx (excl. 408/425/429) → permanent
    const { classifyFetchStatus } = await import("@/lib/syncClassify");
    classifyFetchStatus(res.status, msg);
  }
}

// ---------------------------------------------------------------------------
// Generated-client helpers (pass options as RequestInit so X-Idempotency-Key
// flows through customFetch → actual fetch headers)
// ---------------------------------------------------------------------------

async function postReassignRouteStops(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as ReassignRouteStopsPayload | null;
  if (!p || !Array.isArray(p.groups) || p.groups.length === 0) {
    malformedPayload("reassignRouteStops");
  }
  try {
    await reassignRouteStops({ groups: p.groups }, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Reassign stops rejected by server");
  }
}

// Add-stop replay: server-side rejections (ApiError / 4xx) are treated as
// permanent failures — the write stays in the queue with failedReason set in
// the tray instead of vanishing into an alert. Transient errors (network,
// 5xx, 408/425/429) are re-thrown so flushQueue can keep the item as "Waiting".
async function postAddRouteStop(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as AddRouteStopPayload | null;
  if (!p || typeof p.routeId !== "number") malformedPayload("addRouteStop");
  const hasCustomer = typeof p.customerId === "number";
  const hasProspect = typeof p.prospectId === "number";
  const hasCustom =
    typeof p.customName === "string" && p.customName.trim().length > 0;
  if (!hasCustomer && !hasProspect && !hasCustom) {
    malformedPayload("addRouteStop");
  }
  try {
    await addRouteStop(
      p.routeId,
      hasCustomer
        ? { customerId: p.customerId as number }
        : hasProspect
          ? { prospectId: p.prospectId as number }
          : {
              custom: {
                name: p.customName as string,
                address: p.customAddress ?? null,
                lat: p.customLat ?? null,
                lng: p.customLng ?? null,
              },
            },
      idempotentOpts(writeId),
    );
  } catch (err) {
    classifyAndRethrow(err, "Stop add rejected by server");
  }
}

// Custom-stop edit replay. Only the fields the rep changed are present in the
// payload; the PATCH sends exactly those so untouched fields keep their server
// values. 4xx (stop deleted, not a custom stop, validation) is permanent —
// surface in the tray; transient errors re-throw so the item stays "Waiting".
async function postUpdateRouteStop(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as UpdateRouteStopPayload | null;
  if (!p || typeof p.routeId !== "number" || typeof p.stopId !== "number") {
    malformedPayload("updateRouteStop");
  }
  const data: {
    name?: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  } = {};
  if (typeof p.name === "string" && p.name.trim().length > 0) data.name = p.name;
  if (p.address !== undefined) {
    data.address = p.address;
    if (p.lat != null && p.lng != null) {
      data.lat = p.lat;
      data.lng = p.lng;
    }
  }
  if (Object.keys(data).length === 0) {
    malformedPayload("updateRouteStop");
  }
  try {
    await updateRouteStop(p.routeId, p.stopId, data, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Stop edit rejected by server");
  }
}

async function postCheckInRouteStop(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as CheckInRouteStopPayload | null;
  if (!p || typeof p.routeId !== "number" || typeof p.stopId !== "number") {
    malformedPayload("checkInRouteStop");
  }
  try {
    await checkInRouteStop(p.routeId, p.stopId, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Check-in rejected by server");
  }
}

// Stop-delete replay. A 404 means the stop is already gone (deleted from
// another device or by a manager) — treat that as success so the queue item
// drains instead of surfacing a pointless failure. Other 4xx are permanent;
// transient errors re-throw so the item stays "Waiting".
async function postDeleteRouteStop(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as DeleteRouteStopPayload | null;
  if (!p || typeof p.routeId !== "number" || typeof p.stopId !== "number") {
    malformedPayload("deleteRouteStop");
  }
  try {
    await deleteRouteStop(p.routeId, p.stopId, idempotentOpts(writeId));
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const status = (err as { status: number }).status;
      if (status === 404) return; // already gone — desired end state
    }
    classifyAndRethrow(err, "Stop removal rejected by server");
  }
}

// Sampling-plan create replay. 4xx from the server (field gone, validation)
// is permanent — surface it in the tray. Transient errors (network, 5xx) are
// re-thrown so flushQueue keeps the item as "Waiting" for auto-retry.
async function postSamplingPlan(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as SamplingPlanPayload | null;
  if (!p || typeof p.fieldId !== "number" || typeof p.name !== "string") {
    malformedPayload("samplingPlan");
  }
  try {
    // Omit blank optionals rather than sending null (generated bodies reject
    // null for optional fields).
    await createSamplingPlan(
      {
        fieldId: p.fieldId,
        name: p.name,
        sampleTypes: Array.isArray(p.sampleTypes) ? p.sampleTypes : [],
        ...(typeof p.customerId === "number" ? { customerId: p.customerId } : {}),
        ...(p.season ? { season: p.season } : {}),
      },
      idempotentOpts(writeId),
    );
  } catch (err) {
    classifyAndRethrow(err, "Plan rejected by server");
  }
}

// Add-a-point replay. Mirrors build.tsx's createPointAt: create the sample,
// then assign a bag ID (claiming a scanned pre-printed label first when one was
// carried). Compound steps use deterministic sub-keys so retries resume at the
// right step:
//   writeId:create  → createSamples
//   writeId:claim   → claimSampleCode  (when pendingCode is present)
//   writeId:assign  → assignSampleCode (fallback / no-code path)
//
// Every step is classified. Transient claim/assign failures keep the queue item
// so replay can resume from the server-cached create response.
async function postSamplingAddPoint(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as SamplingAddPointPayload | null;
  if (
    !p ||
    typeof p.planId !== "number" ||
    typeof p.latitude !== "number" ||
    typeof p.longitude !== "number"
  ) {
    malformedPayload("samplingAddPoint");
  }
  let created: Awaited<ReturnType<typeof createSamples>>;
  try {
    created = await createSamples(
      p.planId,
      {
        samples: [
          {
            sampleType: p.sampleType,
            locationType: "point",
            latitude: p.latitude,
            longitude: p.longitude,
            geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
            sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 0,
          },
        ],
      },
      idempotentOpts(stepKey(writeId, "create")),
    );
  } catch (err) {
    classifyAndRethrow(err, "Sample point rejected by server");
  }
  const sample = created[0];
  if (sample && !sample.trackingCode) {
    if (p.pendingCode) {
      try {
        await claimSampleCode(
          sample.id,
          { code: p.pendingCode },
          idempotentOpts(stepKey(writeId, "claim")),
        );
      } catch (err) {
        // A definitive client rejection means the scanned label is unknown,
        // voided, or already taken. Fall back to a generated bag ID. Network,
        // timeout, rate-limit, and server failures must retry the claim.
        if (!isNonRetryableClientError(err)) {
          classifyAndRethrow(err, "Sample bag label could not be claimed");
        }
        try {
          await assignSampleCode(
            sample.id,
            idempotentOpts(stepKey(writeId, "assign")),
          );
        } catch (assignErr) {
          classifyAndRethrow(assignErr, "Sample bag code could not be assigned");
        }
      }
    } else {
      try {
        await assignSampleCode(
          sample.id,
          idempotentOpts(stepKey(writeId, "assign")),
        );
      } catch (err) {
        classifyAndRethrow(err, "Sample bag code could not be assigned");
      }
    }
  }
}

// Generate-grid replay. The server computes the grid inside the field boundary
// and creates the points. 4xx (no boundary / no cells inside it) is permanent;
// transient errors re-throw so the item stays "Waiting".
async function postSamplingGrid(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as SamplingGridPayload | null;
  if (!p || typeof p.planId !== "number") malformedPayload("samplingGrid");
  try {
    await generateSamplingGrid(
      p.planId,
      {
        cellAcres: p.cellAcres,
        sampleType: p.sampleType,
        createSamples: true,
        replaceExisting: !!p.replaceExisting,
      },
      idempotentOpts(writeId),
    );
  } catch (err) {
    classifyAndRethrow(err, "Grid rejected by server");
  }
}

async function postServiceJobComplete(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as {
    workItemId: number;
    data: CompleteServiceJobInput;
  } | null;
  if (!p || typeof p.workItemId !== "number") malformedPayload("serviceJobComplete");
  try {
    await completeServiceJob(p.workItemId, p.data, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Job completion rejected by server");
  }
}

async function postServiceJobEnRoute(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as {
    workItemId: number;
    data?: JobMilestoneInput;
  } | null;
  if (!p || typeof p.workItemId !== "number") malformedPayload("serviceJobEnRoute");
  try {
    await stampJobEnRoute(
      p.workItemId,
      p.data ?? {},
      idempotentOpts(writeId),
    );
  } catch (err) {
    classifyAndRethrow(err, "En-route stamp rejected by server");
  }
}

async function postServiceJobOnSite(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as {
    workItemId: number;
    data?: JobMilestoneInput;
  } | null;
  if (!p || typeof p.workItemId !== "number") malformedPayload("serviceJobOnSite");
  try {
    await stampJobOnSite(
      p.workItemId,
      p.data ?? {},
      idempotentOpts(writeId),
    );
  } catch (err) {
    classifyAndRethrow(err, "On-site stamp rejected by server");
  }
}

const LABOR_START_MAP_KEY = "@agriops:svcjob_labor_start_map";

async function readLaborStartMap(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(LABOR_START_MAP_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

async function writeLaborStartMap(map: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(LABOR_START_MAP_KEY, JSON.stringify(map));
}

async function postServiceJobUpdate(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as {
    workItemId: number;
    data: ServiceJobUpdateInput;
  } | null;
  if (!p || typeof p.workItemId !== "number") malformedPayload("serviceJobUpdate");
  try {
    await updateServiceJob(p.workItemId, p.data, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Job update rejected by server");
  }
}

async function postServiceJobParts(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as {
    workItemId: number;
    data: ServiceJobPartsInput;
  } | null;
  if (!p || typeof p.workItemId !== "number") malformedPayload("serviceJobPartsUpdate");
  try {
    await updateServiceJobParts(p.workItemId, p.data, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Parts update rejected by server");
  }
}

async function postServiceLaborStart(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as { workItemId: number; data?: LaborStartInput } | null;
  if (!p || typeof p.workItemId !== "number") malformedPayload("serviceLaborStart");
  let result: Awaited<ReturnType<typeof startServiceJobLabor>>;
  try {
    result = await startServiceJobLabor(
      p.workItemId,
      p.data ?? {},
      idempotentOpts(writeId),
    );
  } catch (err) {
    classifyAndRethrow(err, "Labor start rejected by server");
  }
  const entryId = (result as { entry?: { id?: number } } | null)?.entry?.id;
  if (typeof entryId === "number") {
    const map = await readLaborStartMap();
    map[writeId] = entryId;
    await writeLaborStartMap(map);
  }
}

async function postServiceLaborStop(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as { workItemId: number; entryId: number } | null;
  if (!p || typeof p.workItemId !== "number" || typeof p.entryId !== "number") {
    malformedPayload("serviceLaborStop");
  }
  try {
    await stopServiceJobLabor(p.workItemId, p.entryId, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Labor stop rejected by server");
  }
}

async function postServiceLaborStopForQueuedStart(
  payload: unknown,
  writeId: string,
): Promise<void> {
  const p = payload as {
    workItemId: number;
    startQueueId: string;
  } | null;
  if (
    !p ||
    typeof p.workItemId !== "number" ||
    typeof p.startQueueId !== "string"
  )
    malformedPayload("serviceLaborStopForQueuedStart");
  const map = await readLaborStartMap();
  const entryId = map[p.startQueueId];
  if (typeof entryId !== "number") {
    throw new PermanentSyncError(
      "The paired labor start is unavailable. Recreate this action, or discard this pending item.",
    );
  }
  try {
    await stopServiceJobLabor(p.workItemId, entryId, idempotentOpts(writeId));
  } catch (err) {
    classifyAndRethrow(err, "Paired labor stop rejected by server");
  }
  delete map[p.startQueueId];
  await writeLaborStartMap(map);
}

// Sample collection replay. When a photo was captured offline its local file
// URI is carried in the payload; we upload it to the sample's media context at
// flush time to obtain a media id, then run the status transition with the
// captured GPS / timestamp. 4xx → permanent failure (sample gone / bad code);
// transient errors re-throw so the item stays "Waiting".
async function postSampleTransition(
  payload: unknown,
  token: string,
  writeId: string,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured — cannot replay sampleTransition",
    );
  }
  const p = payload as {
    sampleId: number;
    status: string;
    note?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    collectedAt?: string | null;
    photoLocalUri?: string | null;
    photoContentType?: string | null;
    photoFilename?: string | null;
  } | null;
  if (!p || typeof p.sampleId !== "number" || typeof p.status !== "string") {
    throw new PermanentSyncError(
      "sampleTransition payload is malformed — cannot replay",
    );
  }

  let collectionPhotoMediaId: number | undefined;
  if (p.photoLocalUri) {
    let blob: Blob | null = null;
    try {
      blob = await (await fetch(p.photoLocalUri)).blob();
    } catch {
      // The OS may have evicted a temporary local image. Continue without the
      // photo rather than blocking the captured status/GPS update forever.
    }
    if (blob) {
      const contentType = p.photoContentType ?? "image/jpeg";
      const filename =
        p.photoFilename ?? `sample-${p.sampleId}-${Date.now()}.jpg`;
      const upRes = await fetch(
        `https://${domain}/api/media-attachments/upload?sampleId=${p.sampleId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "x-filename": encodeURIComponent(filename),
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": stepKey(writeId, "photo"),
          },
          body: blob,
        },
      );
      if (upRes.ok) {
        const media = (await upRes.json()) as { id?: number };
        if (typeof media.id !== "number") {
          throw new PermanentSyncError(
            "Photo upload returned no attachment id — review or discard this pending write",
          );
        }
        collectionPhotoMediaId = media.id;
      } else {
        let message = `Photo upload rejected (HTTP ${upRes.status})`;
        try {
          const result = (await upRes.json()) as { error?: string };
          if (result.error) message = result.error;
        } catch {
          // Keep the status-based message for non-JSON responses.
        }
        const { classifyFetchStatus } = await import("@/lib/syncClassify");
        classifyFetchStatus(upRes.status, message);
      }
    }
  }

  const body: Record<string, unknown> = { status: p.status };
  if (p.note) body.note = p.note;
  if (typeof p.latitude === "number") body.latitude = p.latitude;
  if (typeof p.longitude === "number") body.longitude = p.longitude;
  if (p.collectedAt) body.collectedAt = p.collectedAt;
  if (typeof collectionPhotoMediaId === "number")
    body.collectionPhotoMediaId = collectionPhotoMediaId;

  const res = await fetch(
    `https://${domain}/api/samples/${p.sampleId}/transition`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": stepKey(writeId, "transition"),
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    let msg = `Sample update rejected (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // non-JSON body; keep default message
    }
    const { classifyFetchStatus } = await import("@/lib/syncClassify");
    classifyFetchStatus(res.status, msg);
  }
}

async function postCompleteDeliveryStop(
  payload: unknown,
  token: string,
  writeId: string,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured — cannot replay completeDeliveryStop",
    );
  }
  const p = payload as { stopId: number; body: Record<string, unknown> } | null;
  if (!p || typeof p.stopId !== "number") {
    throw new PermanentSyncError(
      "completeDeliveryStop payload is malformed — cannot replay",
    );
  }
  const res = await fetch(
    `https://${domain}/api/deliveries/stops/${p.stopId}/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": writeId,
      },
      body: JSON.stringify(p.body),
    },
  );
  if (!res.ok) {
    let msg = `Delivery stop completion rejected (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // non-JSON body
    }
    const { classifyFetchStatus } = await import("@/lib/syncClassify");
    classifyFetchStatus(res.status, msg);
  }
}

async function postDeliveryIncident(
  payload: unknown,
  token: string,
  writeId: string,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured — cannot replay deliveryIncident",
    );
  }
  const p = payload as { stopId: number; body: Record<string, unknown> } | null;
  if (!p || typeof p.stopId !== "number") {
    throw new PermanentSyncError(
      "deliveryIncident payload is malformed — cannot replay",
    );
  }
  const res = await fetch(
    `https://${domain}/api/deliveries/stops/${p.stopId}/incidents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": writeId,
      },
      body: JSON.stringify(p.body),
    },
  );
  if (!res.ok) {
    let msg = `Delivery incident rejected (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // non-JSON body
    }
    const { classifyFetchStatus } = await import("@/lib/syncClassify");
    classifyFetchStatus(res.status, msg);
  }
}

async function handleWrite(write: PendingWrite, token: string): Promise<void> {
  const id = write.id;
  if (write.type === "activity") {
    await postActivity(write.payload, token, id);
  } else if (write.type === "workOrder") {
    await replayWorkOrder(write.payload, token, id);
  } else if (write.type === "servicePackageOrder") {
    await postServicePackageOrder(write.payload, token, id);
  } else if (write.type === "reassignRouteStops") {
    await postReassignRouteStops(write.payload, id);
  } else if (write.type === "addRouteStop") {
    await postAddRouteStop(write.payload, id);
  } else if (write.type === "updateRouteStop") {
    await postUpdateRouteStop(write.payload, id);
  } else if (write.type === "checkInRouteStop") {
    await postCheckInRouteStop(write.payload, id);
  } else if (write.type === "deleteRouteStop") {
    await postDeleteRouteStop(write.payload, id);
  } else if (write.type === "completeDeliveryStop") {
    await postCompleteDeliveryStop(write.payload, token, id);
  } else if (write.type === "deliveryIncident") {
    await postDeliveryIncident(write.payload, token, id);
  } else if (write.type === "serviceJobComplete") {
    await postServiceJobComplete(write.payload, id);
  } else if (write.type === "serviceJobEnRoute") {
    await postServiceJobEnRoute(write.payload, id);
  } else if (write.type === "serviceJobOnSite") {
    await postServiceJobOnSite(write.payload, id);
  } else if (write.type === "serviceJobUpdate") {
    await postServiceJobUpdate(write.payload, id);
  } else if (write.type === "serviceJobPartsUpdate") {
    await postServiceJobParts(write.payload, id);
  } else if (write.type === "serviceLaborStart") {
    await postServiceLaborStart(write.payload, id);
  } else if (write.type === "serviceLaborStop") {
    await postServiceLaborStop(write.payload, id);
  } else if (write.type === "serviceLaborStopForQueuedStart") {
    await postServiceLaborStopForQueuedStart(write.payload, id);
  } else if (write.type === "sampleTransition") {
    await postSampleTransition(write.payload, token, id);
  } else if (write.type === "samplingPlan") {
    await postSamplingPlan(write.payload, id);
  } else if (write.type === "samplingAddPoint") {
    await postSamplingAddPoint(write.payload, id);
  } else if (write.type === "samplingGrid") {
    await postSamplingGrid(write.payload, id);
  } else {
    // Unknown write type — this is always a programming error (a new write type
    // was queued but handleWrite was not updated). Surface as permanent so the
    // tray lets the rep discard it rather than wedging the queue forever.
    throw new PermanentSyncError(
      `Unknown offline write type "${(write as { type: string }).type}" — cannot replay. Discard this item and report the issue.`,
    );
  }
}

// Backoff schedule (ms) for periodic flush attempts while the queue is
// non-empty and no explicit trigger is fired.
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

export function QueueSync() {
  const {
    isOnline,
    flushQueue,
    flushSignal,
    pendingCount,
    getPendingRetryId,
    clearPendingRetryId,
  } = useOffline();
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const prevOnlineRef = useRef(false);
  const prevSignalRef = useRef(0);
  const backoffIdxRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const runFlush = useCallback(async () => {
    if (!isSignedIn) return;
    const token = await getToken();
    if (!token) return;

    // Capture any targeted single-item retry id set by retryItem(), then
    // clear it so a subsequent full-queue flush doesn't accidentally filter
    // again. When null, the flush processes the entire queue.
    const targetId = getPendingRetryId();
    clearPendingRetryId();

    let hadRoutesChange = false;
    let hadServiceChange = false;
    let hadSamplingChange = false;
    const activityCustomerIds = new Set<number>();
    // Field ids whose sampling-plan list changed, so the field-detail screen's
    // per-field query (getListFieldSamplingPlansQueryKey) can be invalidated too.
    const samplingFieldIds = new Set<number>();
    // Plan ids whose samples/zones changed (point added, grid generated), so the
    // plan detail + build screens (getGetSamplingPlanQueryKey) refresh on sync.
    const samplingPlanIds = new Set<number>();
    let flushFailed = false;
    let remainingHint = pendingCount;

    try {
      await flushQueue(
        async (write) => {
          try {
            await handleWrite(write, token);
            if (write.type === "activity") {
              const customerId = (
                write.payload as { customerId?: number } | null
              )?.customerId;
              if (typeof customerId === "number") {
                activityCustomerIds.add(customerId);
              }
            } else if (
              write.type === "reassignRouteStops" ||
              write.type === "addRouteStop" ||
              write.type === "updateRouteStop" ||
              write.type === "checkInRouteStop" ||
              write.type === "deleteRouteStop"
            ) {
              hadRoutesChange = true;
            } else if (
              write.type === "serviceJobComplete" ||
              write.type === "serviceJobEnRoute" ||
              write.type === "serviceJobOnSite" ||
              write.type === "serviceJobUpdate" ||
              write.type === "serviceJobPartsUpdate" ||
              write.type === "serviceLaborStart" ||
              write.type === "serviceLaborStop" ||
              write.type === "serviceLaborStopForQueuedStart"
            ) {
              hadServiceChange = true;
            } else if (write.type === "sampleTransition") {
              hadSamplingChange = true;
            } else if (write.type === "samplingPlan") {
              hadSamplingChange = true;
              const fid = (
                write.payload as { fieldId?: number } | null
              )?.fieldId;
              if (typeof fid === "number") samplingFieldIds.add(fid);
            } else if (
              write.type === "samplingAddPoint" ||
              write.type === "samplingGrid"
            ) {
              hadSamplingChange = true;
              const pid = (
                write.payload as { planId?: number } | null
              )?.planId;
              if (typeof pid === "number") samplingPlanIds.add(pid);
            }
          } catch (err) {
            // PermanentSyncError: item stays in queue with failedReason → not
            // an auto-retry candidate, so don't set flushFailed.
            if (!(err instanceof PermanentSyncError)) {
              flushFailed = true;
            }
            throw err;
          }
        },
        targetId ? { only: targetId } : undefined,
      );
    } finally {
      remainingHint = flushFailed ? remainingHint : 0;
    }

    if (hadRoutesChange) {
      queryClient.invalidateQueries({
        queryKey: getListRoutesQueryKey(),
        exact: false,
      });
    }
    if (hadServiceChange) {
      queryClient.invalidateQueries({
        queryKey: getListWorkItemsQueryKey(),
        exact: false,
      });
    }
    if (hadSamplingChange) {
      queryClient.invalidateQueries({
        queryKey: getListSamplingPlansQueryKey(),
        exact: false,
      });
      for (const fid of samplingFieldIds) {
        queryClient.invalidateQueries({
          queryKey: getListFieldSamplingPlansQueryKey(fid),
        });
      }
      for (const pid of samplingPlanIds) {
        queryClient.invalidateQueries({
          queryKey: getGetSamplingPlanQueryKey(pid),
          exact: false,
        });
      }
    }
    for (const customerId of activityCustomerIds) {
      queryClient.invalidateQueries({
        queryKey: getListCustomerActivitiesQueryKey(customerId),
      });
    }

    if (flushFailed && remainingHint > 0) {
      const delay =
        RETRY_BACKOFF_MS[
          Math.min(backoffIdxRef.current, RETRY_BACKOFF_MS.length - 1)
        ];
      backoffIdxRef.current += 1;
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        runFlush();
      }, delay);
    } else {
      backoffIdxRef.current = 0;
      clearRetryTimer();
    }
  }, [
    isSignedIn,
    getToken,
    flushQueue,
    queryClient,
    pendingCount,
    getPendingRetryId,
    clearPendingRetryId,
  ]);

  useEffect(() => {
    const cameOnline = isOnline && !prevOnlineRef.current;
    const flushRequested = flushSignal !== prevSignalRef.current;
    prevOnlineRef.current = isOnline;
    prevSignalRef.current = flushSignal;

    if (!isSignedIn) return;
    if (flushRequested) {
      backoffIdxRef.current = 0;
      clearRetryTimer();
      runFlush();
      return;
    }
    if (cameOnline && pendingCount > 0) {
      backoffIdxRef.current = 0;
      runFlush();
    }
  }, [isOnline, isSignedIn, flushSignal, pendingCount, runFlush]);

  useEffect(() => {
    return () => clearRetryTimer();
  }, []);

  return null;
}

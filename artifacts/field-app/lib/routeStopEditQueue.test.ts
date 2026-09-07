import { describe, expect, it } from "vitest";

import {
  enqueueRouteStopEdit,
  type QueuedWriteLike,
  type UpdateRouteStopPayload,
} from "./routeStopEditQueue";

const payloadOf = (w: QueuedWriteLike) => w.payload as UpdateRouteStopPayload;

describe("enqueueRouteStopEdit", () => {
  it("appends a new updateRouteStop write for an unseen stop", () => {
    const q = enqueueRouteStopEdit<QueuedWriteLike>([], { routeId: 1, stopId: 10, name: "HQ" });
    expect(q).toHaveLength(1);
    expect(q[0].type).toBe("updateRouteStop");
    expect(payloadOf(q[0])).toMatchObject({ routeId: 1, stopId: 10, name: "HQ" });
  });

  it("coalesces a second edit for the same stop, latest field wins", () => {
    let q = enqueueRouteStopEdit<QueuedWriteLike>([], { routeId: 1, stopId: 10, name: "Old name" });
    q = enqueueRouteStopEdit(q, { routeId: 1, stopId: 10, name: "New name" });
    expect(q).toHaveLength(1);
    expect(payloadOf(q[0]).name).toBe("New name");
  });

  it("merges a name-only edit with a queued address-only edit", () => {
    let q = enqueueRouteStopEdit<QueuedWriteLike>([], {
      routeId: 1,
      stopId: 10,
      address: "123 Main St",
      lat: 40,
      lng: -90,
    });
    q = enqueueRouteStopEdit(q, { routeId: 1, stopId: 10, name: "Renamed" });
    expect(q).toHaveLength(1);
    expect(payloadOf(q[0])).toMatchObject({
      name: "Renamed",
      address: "123 Main St",
      lat: 40,
      lng: -90,
    });
  });

  it("replaces lat/lng together with a new address (no stale coordinates)", () => {
    let q = enqueueRouteStopEdit<QueuedWriteLike>([], {
      routeId: 1,
      stopId: 10,
      address: "Old place",
      lat: 40,
      lng: -90,
    });
    // "Use as typed" address carries no coordinates → server re-geocodes.
    q = enqueueRouteStopEdit(q, {
      routeId: 1,
      stopId: 10,
      address: "New freeform address",
      lat: null,
      lng: null,
    });
    expect(payloadOf(q[0])).toMatchObject({
      address: "New freeform address",
      lat: null,
      lng: null,
    });
  });

  it("clears failedReason so a re-edit of a failed write retries as Waiting", () => {
    const failed: QueuedWriteLike = {
      id: "w1",
      type: "updateRouteStop",
      payload: { routeId: 1, stopId: 10, name: "Bad" },
      createdAt: 1,
      failedReason: "HTTP 400",
    };
    const q = enqueueRouteStopEdit([failed], { routeId: 1, stopId: 10, name: "Good" });
    expect(q[0].failedReason).toBeUndefined();
  });

  it("leaves other write types and other stops untouched", () => {
    const other: QueuedWriteLike = {
      id: "a",
      type: "addRouteStop",
      payload: { routeId: 1, customName: "Cafe" },
      createdAt: 1,
    };
    const otherStop: QueuedWriteLike = {
      id: "b",
      type: "updateRouteStop",
      payload: { routeId: 1, stopId: 99, name: "Other" },
      createdAt: 1,
    };
    const q = enqueueRouteStopEdit([other, otherStop], { routeId: 1, stopId: 10, name: "X" });
    expect(q).toHaveLength(3);
    expect(q[0]).toBe(other);
    expect(q[1]).toBe(otherStop);
  });
});

// Regression for the enqueue/flush race: the modal must AWAIT the enqueue
// (which persists to async storage) before triggering a flush. If the flush
// reads storage before the enqueue write lands, the edit is stranded until an
// unrelated event. This simulates both orderings against an async store with
// the same read-modify-write shape OfflineContext uses.
describe("offline edit persists before flush reads the queue", () => {
  function makeStore() {
    let stored = "[]";
    return {
      // Async like AsyncStorage: reads/writes settle on the microtask queue.
      getItem: async () => stored,
      setItem: async (v: string) => {
        await Promise.resolve();
        stored = v;
      },
    };
  }

  async function enqueue(store: ReturnType<typeof makeStore>, payload: UpdateRouteStopPayload) {
    const queue: QueuedWriteLike[] = JSON.parse(await store.getItem());
    await store.setItem(JSON.stringify(enqueueRouteStopEdit(queue, payload)));
  }

  async function flush(store: ReturnType<typeof makeStore>): Promise<QueuedWriteLike[]> {
    return JSON.parse(await store.getItem());
  }

  it("awaited enqueue → flush sees the edit (fixed behavior)", async () => {
    const store = makeStore();
    await enqueue(store, { routeId: 1, stopId: 10, name: "Renamed" });
    const seen = await flush(store);
    expect(seen).toHaveLength(1);
    expect(payloadOf(seen[0]).name).toBe("Renamed");
  });

  it("un-awaited enqueue can race the flush and lose the edit (why we await)", async () => {
    const store = makeStore();
    const pending = enqueue(store, { routeId: 1, stopId: 10, name: "Renamed" });
    const seen = await flush(store); // flush fired before enqueue settled
    expect(seen).toHaveLength(0);
    await pending;
  });
});

import { describe, expect, it } from "vitest";

import {
  applyPendingAddStops,
  DUPLICATE_TAP_WINDOW_MS,
  enqueueRouteStopAdd,
  type AddRouteStopPayload,
  type QueuedWriteLike,
  type RouteLike,
  type RouteStopLike,
} from "./routeStopAddQueue";

const payloadOf = (w: QueuedWriteLike) => w.payload as AddRouteStopPayload;

const customerAdd: AddRouteStopPayload = {
  routeId: 1,
  customerId: 5,
  customerName: "Acme Farms",
  customerAddress: "1 Farm Rd",
  customerCity: "Ames",
  customerState: "IA",
};

const prospectAdd: AddRouteStopPayload = {
  routeId: 1,
  prospectId: 7,
  prospectName: "New Grower",
};

const customAdd: AddRouteStopPayload = {
  routeId: 1,
  customName: "Co-op meeting",
  customAddress: "2 Elevator Way",
  customLat: 41.5,
  customLng: -93.6,
};

function stop(partial: Partial<RouteStopLike> & { id: number }): RouteStopLike {
  return {
    routeId: 1,
    kind: "customer",
    customerId: null,
    prospectId: null,
    prospectName: null,
    customerName: null,
    customerAddress: null,
    customerCity: null,
    customerState: null,
    lat: null,
    lng: null,
    stopOrder: 1,
    checkedInAt: null,
    distanceKmFromPrev: null,
    estimatedMinutesFromPrev: null,
    geometryFromPrev: null,
    ...partial,
  };
}

function write(payload: AddRouteStopPayload, createdAt = 0, id = "w"): QueuedWriteLike {
  return { id, type: "addRouteStop", payload, createdAt };
}

describe("enqueueRouteStopAdd", () => {
  it("appends adds for customer, prospect, and custom payloads", () => {
    let q = enqueueRouteStopAdd<QueuedWriteLike>([], customerAdd, 0);
    q = enqueueRouteStopAdd(q, prospectAdd, 10);
    q = enqueueRouteStopAdd(q, customAdd, 20);
    expect(q).toHaveLength(3);
    expect(q.every((w) => w.type === "addRouteStop")).toBe(true);
    expect(payloadOf(q[0]).customerId).toBe(5);
    expect(payloadOf(q[1]).prospectId).toBe(7);
    expect(payloadOf(q[2]).customName).toBe("Co-op meeting");
  });

  it.each([
    ["customer", customerAdd],
    ["prospect", prospectAdd],
    ["custom", customAdd],
  ])("suppresses a duplicate %s tap within the window", (_kind, payload) => {
    const q1 = enqueueRouteStopAdd<QueuedWriteLike>([], payload, 1000);
    const q2 = enqueueRouteStopAdd(q1, payload, 1000 + DUPLICATE_TAP_WINDOW_MS - 1);
    expect(q2).toBe(q1); // same reference: suppressed
    expect(q2).toHaveLength(1);
  });

  it("allows the same target again after the suppression window", () => {
    const q1 = enqueueRouteStopAdd<QueuedWriteLike>([], customerAdd, 1000);
    const q2 = enqueueRouteStopAdd(q1, customerAdd, 1000 + DUPLICATE_TAP_WINDOW_MS);
    expect(q2).toHaveLength(2);
  });

  it("does not suppress a different target inside the window", () => {
    let q = enqueueRouteStopAdd<QueuedWriteLike>([], customerAdd, 1000);
    q = enqueueRouteStopAdd(q, { ...customerAdd, customerId: 6 }, 1001);
    q = enqueueRouteStopAdd(q, { ...customAdd, customName: "Other spot" }, 1002);
    q = enqueueRouteStopAdd(q, customAdd, 1003);
    expect(q).toHaveLength(4);
  });

  it("does not suppress the same target on a different route", () => {
    const q1 = enqueueRouteStopAdd<QueuedWriteLike>([], customerAdd, 1000);
    const q2 = enqueueRouteStopAdd(q1, { ...customerAdd, routeId: 2 }, 1001);
    expect(q2).toHaveLength(2);
  });

  it("ignores non-addRouteStop writes when checking duplicates", () => {
    const other: QueuedWriteLike = {
      id: "x",
      type: "checkInRouteStop",
      payload: { routeId: 1, stopId: 5 },
      createdAt: 1000,
    };
    const q = enqueueRouteStopAdd([other], customerAdd, 1001);
    expect(q).toHaveLength(2);
  });
});

describe("applyPendingAddStops", () => {
  const routes: RouteLike[] = [{ id: 1, stops: [] }, { id: 2, stops: [] }];

  it("returns routes untouched when no adds are queued", () => {
    expect(applyPendingAddStops(routes, [])).toBe(routes);
  });

  it("overlays customer, prospect, and custom adds as synthetic negative-id stops", () => {
    const result = applyPendingAddStops(routes, [
      write(customerAdd, 0, "a"),
      write(prospectAdd, 0, "b"),
      write(customAdd, 0, "c"),
    ]);
    const stops = result[0].stops!;
    expect(stops).toHaveLength(3);
    expect(stops.map((s) => s.id)).toEqual([-1, -2, -3]);
    expect(stops[0]).toMatchObject({
      kind: "customer",
      customerId: 5,
      customerName: "Acme Farms",
      customerCity: "Ames",
      prospectId: null,
    });
    expect(stops[1]).toMatchObject({
      kind: "prospect",
      prospectId: 7,
      prospectName: "New Grower",
      customerId: null,
      customerName: null,
    });
    expect(stops[2]).toMatchObject({
      kind: "custom",
      customerId: null,
      prospectId: null,
      customerName: "Co-op meeting",
      customerAddress: "2 Elevator Way",
      lat: 41.5,
      lng: -93.6,
    });
    // Other route untouched.
    expect(result[1].stops).toHaveLength(0);
  });

  it("only overlays onto the route the add targets", () => {
    const result = applyPendingAddStops(routes, [write({ ...customerAdd, routeId: 2 })]);
    expect(result[0].stops).toHaveLength(0);
    expect(result[1].stops).toHaveLength(1);
  });

  it("appends after existing stops with sequential stopOrder", () => {
    const withStops: RouteLike[] = [
      { id: 1, stops: [stop({ id: 100, stopOrder: 1 }), stop({ id: 101, stopOrder: 2 })] },
    ];
    const result = applyPendingAddStops(withStops, [
      write(prospectAdd, 0, "a"),
      write(customAdd, 0, "b"),
    ]);
    const stops = result[0].stops!;
    expect(stops.map((s) => s.id)).toEqual([100, 101, -1, -2]);
    expect(stops[2].stopOrder).toBe(3);
    expect(stops[3].stopOrder).toBe(4);
  });

  it("skips a customer add the server refetch already returned (no duplicate)", () => {
    const landed: RouteLike[] = [
      { id: 1, stops: [stop({ id: 100, kind: "customer", customerId: 5 })] },
    ];
    const result = applyPendingAddStops(landed, [write(customerAdd)]);
    expect(result[0].stops).toHaveLength(1);
    expect(result[0].stops![0].id).toBe(100);
  });

  it("skips a prospect add the server refetch already returned", () => {
    const landed: RouteLike[] = [
      { id: 1, stops: [stop({ id: 100, kind: "prospect", prospectId: 7 })] },
    ];
    const result = applyPendingAddStops(landed, [write(prospectAdd)]);
    expect(result[0].stops).toHaveLength(1);
  });

  it("skips a custom add when a custom stop with the same name landed", () => {
    const landed: RouteLike[] = [
      { id: 1, stops: [stop({ id: 100, kind: "custom", customerName: "Co-op meeting" })] },
    ];
    const result = applyPendingAddStops(landed, [write(customAdd)]);
    expect(result[0].stops).toHaveLength(1);
  });

  it("does not confuse a customer stop's name with a custom stop's name", () => {
    // A customer stop named like the custom stop must NOT suppress the overlay.
    const landed: RouteLike[] = [
      {
        id: 1,
        stops: [stop({ id: 100, kind: "customer", customerId: 9, customerName: "Co-op meeting" })],
      },
    ];
    const result = applyPendingAddStops(landed, [write(customAdd)]);
    expect(result[0].stops).toHaveLength(2);
  });

  it("keeps unlanded adds visible while another add for the route has landed", () => {
    const landed: RouteLike[] = [
      { id: 1, stops: [stop({ id: 100, kind: "customer", customerId: 5 })] },
    ];
    const result = applyPendingAddStops(landed, [
      write(customerAdd, 0, "a"),
      write(prospectAdd, 0, "b"),
    ]);
    const stops = result[0].stops!;
    expect(stops).toHaveLength(2);
    expect(stops[1]).toMatchObject({ kind: "prospect", prospectId: 7 });
  });

  it("drops a payload with no target identity instead of rendering a ghost stop", () => {
    const result = applyPendingAddStops(routes, [write({ routeId: 1 })]);
    expect(result[0].stops).toHaveLength(0);
  });

  it("handles routes with null/undefined stops arrays", () => {
    const nullStops: RouteLike[] = [{ id: 1, stops: null }];
    const result = applyPendingAddStops(nullStops, [write(customerAdd)]);
    expect(result[0].stops).toHaveLength(1);
    expect(result[0].stops![0].id).toBe(-1);
  });

  it("keeps synthetic ids stable per-write across landed adds (React key stability)", () => {
    // Two queued adds; first one lands. The surviving overlay keeps the id
    // derived from its queue position (-2), not a re-numbered -1.
    const landed: RouteLike[] = [
      { id: 1, stops: [stop({ id: 100, kind: "customer", customerId: 5 })] },
    ];
    const result = applyPendingAddStops(landed, [
      write(customerAdd, 0, "a"),
      write(prospectAdd, 0, "b"),
    ]);
    expect(result[0].stops![1].id).toBe(-2);
  });
});

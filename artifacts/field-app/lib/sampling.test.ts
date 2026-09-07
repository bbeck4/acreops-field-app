import { describe, it, expect } from "vitest";
import type { Sample } from "@workspace/api-client-react";
import { pickNextSample, pointInGeometry } from "@/lib/sampling";

// Minimal Sample factory — only the fields the helpers read actually matter;
// the rest get harmless defaults so the object satisfies the type at runtime.
function makeSample(overrides: Partial<Sample> & { id: number }): Sample {
  return {
    planId: 1,
    fieldId: 1,
    sampleType: "soil",
    locationType: "zone",
    status: "planned",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Sample;
}

describe("pickNextSample", () => {
  it("prefers an uncollected point in the active zone", () => {
    const samples = [
      makeSample({ id: 1, zoneId: 9, sortOrder: 5 }),
      makeSample({ id: 2, zoneId: 7, sortOrder: 1 }),
      makeSample({ id: 3, zoneId: 7, sortOrder: 2 }),
    ];
    // Even though id 1 has no live-location preference and lower-sortOrder
    // candidates exist in zone 7, asking for zone 7 should return zone 7's
    // first point by sortOrder.
    const next = pickNextSample(samples, { preferZoneId: 7 });
    expect(next?.id).toBe(2);
  });

  it("falls back to other zones when the active zone is fully collected", () => {
    const samples = [
      makeSample({ id: 1, zoneId: 7, status: "collected", sortOrder: 1 }),
      makeSample({ id: 2, zoneId: 9, sortOrder: 3 }),
      makeSample({ id: 3, zoneId: 9, sortOrder: 2 }),
    ];
    const next = pickNextSample(samples, { preferZoneId: 7 });
    expect(next?.id).toBe(3);
  });

  it("skips ids listed in excludeIds (so chaining never loops offline)", () => {
    const samples = [
      makeSample({ id: 1, sortOrder: 1 }),
      makeSample({ id: 2, sortOrder: 2 }),
      makeSample({ id: 3, sortOrder: 3 }),
    ];
    const next = pickNextSample(samples, { excludeIds: new Set([1, 2]) });
    expect(next?.id).toBe(3);
  });

  it("orders by sortOrder when there's no live origin", () => {
    const samples = [
      makeSample({ id: 1, sortOrder: 30 }),
      makeSample({ id: 2, sortOrder: 10 }),
      makeSample({ id: 3, sortOrder: 20 }),
    ];
    const next = pickNextSample(samples);
    expect(next?.id).toBe(2);
  });

  it("picks the nearest point to the origin when coordinates are present", () => {
    const samples = [
      makeSample({ id: 1, sortOrder: 1, latitude: 40.0, longitude: -90.0 }),
      makeSample({ id: 2, sortOrder: 2, latitude: 40.5, longitude: -90.5 }),
    ];
    // Origin sits right next to id 2 — distance must win over sortOrder.
    const next = pickNextSample(samples, {
      origin: { latitude: 40.5, longitude: -90.5 },
    });
    expect(next?.id).toBe(2);
  });

  it("skips excluded ids even inside the preferred zone", () => {
    const samples = [
      makeSample({ id: 1, zoneId: 7, sortOrder: 1 }),
      makeSample({ id: 2, zoneId: 7, sortOrder: 2 }),
    ];
    const next = pickNextSample(samples, {
      preferZoneId: 7,
      excludeIds: new Set([1]),
    });
    expect(next?.id).toBe(2);
  });

  it("returns null when everything is collected", () => {
    const samples = [
      makeSample({ id: 1, status: "collected" }),
      makeSample({ id: 2, status: "results_received" }),
      makeSample({ id: 3, status: "completed" }),
    ];
    expect(pickNextSample(samples)).toBeNull();
  });

  it("returns null when every remaining point is excluded", () => {
    const samples = [makeSample({ id: 1 }), makeSample({ id: 2 })];
    expect(pickNextSample(samples, { excludeIds: new Set([1, 2]) })).toBeNull();
  });
});

describe("pointInGeometry", () => {
  // A simple square covering [0,0] .. [10,10] (GeoJSON rings are [lng, lat]).
  const square = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };

  it("reports a point inside a simple polygon", () => {
    expect(pointInGeometry({ latitude: 5, longitude: 5 }, square)).toBe(true);
  });

  it("reports a point outside a simple polygon", () => {
    expect(pointInGeometry({ latitude: 50, longitude: 50 }, square)).toBe(false);
  });

  it("treats a point inside a polygon hole as outside", () => {
    // Outer 0..10 square with an inner 3..7 hole; even-odd fill cancels out.
    const donut = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
          [3, 3],
        ],
      ],
    };
    // Inside the hole -> outside.
    expect(pointInGeometry({ latitude: 5, longitude: 5 }, donut)).toBe(false);
    // Inside the outer ring but outside the hole -> inside.
    expect(pointInGeometry({ latitude: 1, longitude: 1 }, donut)).toBe(true);
  });

  it("reports a point inside one part of a MultiPolygon", () => {
    const multi = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
        [
          [
            [20, 20],
            [30, 20],
            [30, 30],
            [20, 30],
            [20, 20],
          ],
        ],
      ],
    };
    // Inside the second part.
    expect(pointInGeometry({ latitude: 25, longitude: 25 }, multi)).toBe(true);
    // In the gap between the two parts.
    expect(pointInGeometry({ latitude: 15, longitude: 15 }, multi)).toBe(false);
  });

  it("returns false for geometry with no rings", () => {
    expect(pointInGeometry({ latitude: 5, longitude: 5 }, null)).toBe(false);
    expect(pointInGeometry({ latitude: 5, longitude: 5 }, {})).toBe(false);
  });
});

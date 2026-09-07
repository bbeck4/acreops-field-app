import { describe, it, expect } from "vitest";
import {
  BASE_LAYERS,
  BASE_LAYER_ORDER,
  extractPolygons,
  extractRings,
  computeBounds,
  fitZoom,
  type LngLat,
  type Bounds,
} from "@/lib/mapTiles";

describe("base map layers", () => {
  it("includes a terrain layer with a native-compatible XYZ template", () => {
    expect(BASE_LAYER_ORDER).toEqual(["streets", "satellite", "hybrid", "terrain"]);
    expect(BASE_LAYERS.terrain.tileUrl("{z}", "{x}", "{y}")).toContain(
      "World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    );
  });
});

describe("extractPolygons", () => {
  it("preserves a Polygon outer ring with its interior hole", () => {
    const outer: LngLat[] = [[0, 0], [4, 0], [4, 4], [0, 0]];
    const hole: LngLat[] = [[1, 1], [2, 1], [2, 2], [1, 1]];
    expect(extractPolygons({ type: "Polygon", coordinates: [outer, hole] })).toEqual([
      [outer, hole],
    ]);
  });

  it("keeps MultiPolygon parts separate", () => {
    const first: LngLat[] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const second: LngLat[] = [[3, 3], [4, 3], [4, 4], [3, 3]];
    expect(extractPolygons({
      type: "MultiPolygon",
      coordinates: [[[...first]], [[...second]]],
    })).toEqual([[first], [second]]);
  });
});

describe("extractRings", () => {
  it("pulls the rings out of a Polygon", () => {
    const polygon = {
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
    const rings = extractRings(polygon);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
  });

  it("flattens the rings of a MultiPolygon", () => {
    const multi = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [20, 20],
            [21, 20],
            [21, 21],
            [20, 20],
          ],
          [
            [20.2, 20.2],
            [20.8, 20.2],
            [20.8, 20.8],
            [20.2, 20.2],
          ],
        ],
      ],
    };
    const rings = extractRings(multi);
    // First part has one ring, second part has two (outer + hole) -> 3 total.
    expect(rings).toHaveLength(3);
    expect(rings[0][0]).toEqual([0, 0]);
    expect(rings[2][0]).toEqual([20.2, 20.2]);
  });

  it("recurses into a Feature's geometry", () => {
    const feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 0],
          ],
        ],
      },
    };
    const rings = extractRings(feature);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it("recurses into every feature of a FeatureCollection", () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [10, 10],
                [11, 10],
                [11, 11],
                [10, 10],
              ],
            ],
          },
        },
      ],
    };
    const rings = extractRings(collection);
    expect(rings).toHaveLength(2);
    expect(rings[0][0]).toEqual([0, 0]);
    expect(rings[1][0]).toEqual([10, 10]);
  });

  it("returns [] for non-geometry input", () => {
    expect(extractRings(null)).toEqual([]);
    expect(extractRings(undefined)).toEqual([]);
    expect(extractRings("not geometry")).toEqual([]);
    expect(extractRings(42)).toEqual([]);
    expect(extractRings({})).toEqual([]);
    expect(extractRings({ type: "Point", coordinates: [0, 0] })).toEqual([]);
  });
});

describe("computeBounds", () => {
  it("computes min/max lng/lat across a single ring", () => {
    const rings: LngLat[][] = [
      [
        [-90, 40],
        [-80, 40],
        [-80, 45],
        [-90, 45],
        [-90, 40],
      ],
    ];
    expect(computeBounds(rings)).toEqual({
      minLng: -90,
      maxLng: -80,
      minLat: 40,
      maxLat: 45,
    });
  });

  it("computes bounds spanning multiple rings", () => {
    const rings: LngLat[][] = [
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 0],
      ],
      [
        [-3, -2],
        [8, -2],
        [8, 12],
        [-3, -2],
      ],
    ];
    expect(computeBounds(rings)).toEqual({
      minLng: -3,
      maxLng: 8,
      minLat: -2,
      maxLat: 12,
    });
  });

  it("returns null for empty input", () => {
    expect(computeBounds([])).toBeNull();
    expect(computeBounds([[]])).toBeNull();
  });
});

describe("fitZoom", () => {
  it("yields a higher zoom for a small bounds than a large bounds", () => {
    const small: Bounds = { minLng: -90.001, maxLng: -89.999, minLat: 40, maxLat: 40.002 };
    const large: Bounds = { minLng: -100, maxLng: -80, minLat: 30, maxLat: 50 };
    const smallZoom = fitZoom(small, 320, 480);
    const largeZoom = fitZoom(large, 320, 480);
    expect(smallZoom).toBeGreaterThan(largeZoom);
  });

  it("keeps results within the 3..maxZoom range", () => {
    const tiny: Bounds = { minLng: -90.00001, maxLng: -90, minLat: 40, maxLat: 40.00001 };
    const huge: Bounds = { minLng: -179, maxLng: 179, minLat: -85, maxLat: 85 };

    const tinyZoom = fitZoom(tiny, 320, 480, 18);
    expect(tinyZoom).toBeGreaterThanOrEqual(3);
    expect(tinyZoom).toBeLessThanOrEqual(18);

    const hugeZoom = fitZoom(huge, 320, 480, 18);
    expect(hugeZoom).toBeGreaterThanOrEqual(3);
    expect(hugeZoom).toBeLessThanOrEqual(18);
  });

  it("respects a custom maxZoom ceiling", () => {
    const small: Bounds = { minLng: -90.0001, maxLng: -89.9999, minLat: 40, maxLat: 40.0002 };
    const zoom = fitZoom(small, 320, 480, 12);
    expect(zoom).toBeGreaterThanOrEqual(3);
    expect(zoom).toBeLessThanOrEqual(12);
  });
});

export const TILE_SIZE = 256;

export type LngLat = [number, number];

export type BaseLayerId = "streets" | "satellite" | "hybrid" | "terrain";

export type BaseLayer = {
  id: BaseLayerId;
  label: string;
  tileUrl: (z: number | string, x: number | string, y: number | string) => string;
  overlayUrl?: (z: number | string, x: number | string, y: number | string) => string;
  attribution: string;
  /** Hint that this layer is dark/imagery so chrome can adapt label outlines. */
  imagery: boolean;
};

export const BASE_LAYERS: Record<BaseLayerId, BaseLayer> = {
  streets: {
    id: "streets",
    label: "Streets",
    tileUrl: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: "© OpenStreetMap",
    imagery: false,
  },
  satellite: {
    id: "satellite",
    label: "Satellite",
    tileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: "Esri, Maxar, Earthstar Geographics",
    imagery: true,
  },
  hybrid: {
    id: "hybrid",
    label: "Hybrid",
    tileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    overlayUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
    attribution: "Esri, Maxar, Earthstar Geographics",
    imagery: true,
  },
  terrain: {
    id: "terrain",
    label: "Terrain",
    tileUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    attribution: "Esri",
    imagery: false,
  },
};

export const BASE_LAYER_ORDER: BaseLayerId[] = ["streets", "satellite", "hybrid", "terrain"];

export function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
export function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}
export function tileXToLon(x: number, z: number) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
export function tileYToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function extractRings(geo: unknown): LngLat[][] {
  if (!geo || typeof geo !== "object") return [];
  const g = geo as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (g.type === "FeatureCollection" && Array.isArray(g.features)) return g.features.flatMap((f) => extractRings(f));
  if (g.type === "Feature" && g.geometry) return extractRings(g.geometry);
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) return (g.coordinates as LngLat[][]).filter((r) => Array.isArray(r));
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) return (g.coordinates as LngLat[][][]).flat().filter((r) => Array.isArray(r));
  return [];
}

/** Returns GeoJSON polygons while preserving each outer ring with its interior holes. */
export function extractPolygons(geo: unknown): LngLat[][][] {
  if (!geo || typeof geo !== "object") return [];
  const g = geo as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (g.type === "FeatureCollection" && Array.isArray(g.features)) {
    return g.features.flatMap((feature) => extractPolygons(feature));
  }
  if (g.type === "Feature" && g.geometry) return extractPolygons(g.geometry);
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    return [(g.coordinates as LngLat[][]).filter((ring) => Array.isArray(ring))];
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    return (g.coordinates as LngLat[][][]).map((polygon) => (
      polygon.filter((ring) => Array.isArray(ring))
    ));
  }
  return [];
}

export type Bounds = { minLng: number; maxLng: number; minLat: number; maxLat: number };

export function computeBounds(rings: LngLat[][]): Bounds | null {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!isFinite(minLng)) return null;
  return { minLng, maxLng, minLat, maxLat };
}

/** Largest integer zoom at which the bounds fit within ~85% of the viewport. */
export function fitZoom(bounds: Bounds, width: number, height: number, maxZoom = 18) {
  for (let z = maxZoom; z >= 3; z--) {
    const w = Math.abs(lonToTileX(bounds.maxLng, z) * TILE_SIZE - lonToTileX(bounds.minLng, z) * TILE_SIZE);
    const h = Math.abs(latToTileY(bounds.maxLat, z) * TILE_SIZE - latToTileY(bounds.minLat, z) * TILE_SIZE);
    if (w <= width * 0.85 && h <= height * 0.85) return z;
  }
  return 14;
}

export type MapFeature = {
  id: string;
  rings: LngLat[][];
  fill: string;
  label?: string;
  badge?: number;
};

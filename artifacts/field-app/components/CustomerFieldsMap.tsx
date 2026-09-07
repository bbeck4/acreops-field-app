import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Text as SvgText } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import {
  cropColor,
  cropLabel,
  normalizeCrop,
  soilStatus,
  soilStatusColor,
  soilStatusLabel,
  type SoilStatus,
} from "@/lib/fieldColors";
import { FieldMapFullscreen } from "@/components/FieldMapFullscreen";
import type { MapFeature } from "@/lib/mapTiles";

const TILE_SIZE = 256;

function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}

type LngLat = [number, number];

function extractRings(geo: unknown): LngLat[][] {
  if (!geo || typeof geo !== "object") return [];
  const g = geo as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (g.type === "FeatureCollection" && Array.isArray(g.features)) return g.features.flatMap((f) => extractRings(f));
  if (g.type === "Feature" && g.geometry) return extractRings(g.geometry);
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) return (g.coordinates as LngLat[][]).filter((r) => Array.isArray(r));
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) return (g.coordinates as LngLat[][][]).flat().filter((r) => Array.isArray(r));
  return [];
}

export type FieldBoundaryEntry = {
  fieldId: number;
  fieldName: string;
  cropPlan?: string | null;
  soilTestCount?: number;
  latestSoilTestDate?: string | Date | null;
  geoJson: unknown;
};

type ColorMode = "crop" | "soil";

type Props = {
  fields: FieldBoundaryEntry[];
  height?: number;
  borderColor: string;
  primaryColor: string;
  /** When true, hides the toggle and shows only the legend. Defaults to false. */
  legendOnly?: boolean;
  initialMode?: ColorMode;
};

export function CustomerFieldsMap({
  fields,
  height = 200,
  borderColor,
  primaryColor,
  legendOnly = false,
  initialMode = "crop",
}: Props) {
  const [width, setWidth] = React.useState(0);
  const [mode, setMode] = React.useState<ColorMode>(initialMode);
  const [fullscreen, setFullscreen] = React.useState(false);

  const fieldRings = React.useMemo(
    () =>
      fields
        .map((f) => ({ ...f, rings: extractRings(f.geoJson) }))
        .filter((f) => f.rings.length > 0),
    [fields],
  );

  const mapFeatures = React.useMemo<MapFeature[]>(
    () =>
      fieldRings.map((f) => ({
        id: `field_${f.fieldId}`,
        rings: f.rings,
        fill:
          mode === "crop"
            ? cropColor(f.cropPlan)
            : soilStatusColor(soilStatus(f.latestSoilTestDate ?? null)),
        label: f.cropPlan ? `${f.fieldName} · ${f.cropPlan}` : f.fieldName,
        badge: f.soilTestCount && f.soilTestCount > 0 ? f.soilTestCount : undefined,
      })),
    [fieldRings, mode],
  );

  const legend = React.useMemo(() => {
    if (mode === "crop") {
      const seen = new Map<string, { key: string; label: string; color: string }>();
      for (const f of fieldRings) {
        const key = normalizeCrop(f.cropPlan);
        if (!seen.has(key)) {
          seen.set(key, { key, label: cropLabel(f.cropPlan), color: cropColor(f.cropPlan) });
        }
      }
      return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
    }
    const present = new Set<SoilStatus>();
    for (const f of fieldRings) present.add(soilStatus(f.latestSoilTestDate ?? null));
    const order: SoilStatus[] = ["recent", "stale", "missing"];
    return order
      .filter((s) => present.has(s))
      .map((s) => ({ key: s, label: soilStatusLabel(s), color: soilStatusColor(s) }));
  }, [fieldRings, mode]);

  if (fieldRings.length === 0) {
    return (
      <View style={[styles.empty, { borderColor, height }]}>
        <Text style={styles.emptyText}>No field boundaries available</Text>
      </View>
    );
  }

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of fieldRings) {
    for (const ring of f.rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  const cLng = (minLng + maxLng) / 2;
  const cLat = (minLat + maxLat) / 2;

  let zoom = 14;
  if (width > 0) {
    for (let z = 18; z >= 3; z--) {
      const w = Math.abs(lonToTileX(maxLng, z) * TILE_SIZE - lonToTileX(minLng, z) * TILE_SIZE);
      const h = Math.abs(latToTileY(maxLat, z) * TILE_SIZE - latToTileY(minLat, z) * TILE_SIZE);
      if (w <= width * 0.85 && h <= height * 0.85) { zoom = z; break; }
    }
  }

  return (
    <View>
      <View style={styles.controls}>
        {legendOnly ? (
          <Text style={[styles.modeLabel, { color: "#374151" }]}>
            By {mode === "crop" ? "crop" : "soil-test status"}
          </Text>
        ) : (
          <View style={[styles.toggle, { borderColor }]}>
            {(["crop", "soil"] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[
                    styles.toggleBtn,
                    active && { backgroundColor: primaryColor },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Color by ${m === "crop" ? "crop" : "soil-test status"}`}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      { color: active ? "#ffffff" : "#374151" },
                    ]}
                  >
                    {m === "crop" ? "Crop" : "Soil status"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={styles.legend}>
          {legend.map((it) => (
            <View key={it.key} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: it.color, borderColor: it.color }]} />
              <Text style={styles.legendText}>{it.label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.wrap, { borderColor, height }]}
      >
        {width > 0 ? (
          <Render
            width={width}
            height={height}
            zoom={zoom}
            cLat={cLat}
            cLng={cLng}
            fields={fieldRings}
            mode={mode}
          />
        ) : null}
        <Pressable
          onPress={() => setFullscreen(true)}
          style={styles.expandBtn}
          accessibilityRole="button"
          accessibilityLabel="Open full-screen map"
          hitSlop={8}
        >
          <Feather name="maximize-2" size={16} color="#111827" />
        </Pressable>
        <View pointerEvents="none" style={styles.attrib}>
          <Text style={styles.attribText}>© OpenStreetMap</Text>
        </View>
      </View>
      <FieldMapFullscreen
        visible={fullscreen}
        onClose={() => setFullscreen(false)}
        features={mapFeatures}
        primaryColor={primaryColor}
        title="Field Map"
      />
    </View>
  );
}

function Render({
  width,
  height,
  zoom,
  cLat,
  cLng,
  fields,
  mode,
}: {
  width: number;
  height: number;
  zoom: number;
  cLat: number;
  cLng: number;
  fields: Array<FieldBoundaryEntry & { rings: LngLat[][] }>;
  mode: ColorMode;
}) {
  const cxPx = lonToTileX(cLng, zoom) * TILE_SIZE;
  const cyPx = latToTileY(cLat, zoom) * TILE_SIZE;

  const project = (lng: number, lat: number) => ({
    x: lonToTileX(lng, zoom) * TILE_SIZE - cxPx + width / 2,
    y: latToTileY(lat, zoom) * TILE_SIZE - cyPx + height / 2,
  });

  const maxTile = Math.pow(2, zoom);
  const tilesX = Math.ceil(width / TILE_SIZE) + 2;
  const tilesY = Math.ceil(height / TILE_SIZE) + 2;
  const centerTileX = Math.floor(lonToTileX(cLng, zoom));
  const centerTileY = Math.floor(latToTileY(cLat, zoom));
  const fracX = lonToTileX(cLng, zoom) - centerTileX;
  const fracY = latToTileY(cLat, zoom) - centerTileY;
  const baseOffsetX = width / 2 - fracX * TILE_SIZE;
  const baseOffsetY = height / 2 - fracY * TILE_SIZE;

  const tiles: React.ReactNode[] = [];
  const halfX = Math.floor(tilesX / 2);
  const halfY = Math.floor(tilesY / 2);
  for (let dx = -halfX; dx <= halfX; dx++) {
    for (let dy = -halfY; dy <= halfY; dy++) {
      const ty = centerTileY + dy;
      if (ty < 0 || ty >= maxTile) continue;
      const wrappedX = ((centerTileX + dx) % maxTile + maxTile) % maxTile;
      tiles.push(
        <Image
          key={`${dx}_${dy}`}
          source={{ uri: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png` }}
          style={{
            position: "absolute",
            left: baseOffsetX + dx * TILE_SIZE,
            top: baseOffsetY + dy * TILE_SIZE,
            width: TILE_SIZE,
            height: TILE_SIZE,
          }}
        />,
      );
    }
  }

  return (
    <>
      <View style={StyleSheet.absoluteFill}>{tiles}</View>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {fields.map((f) => {
          const fill = mode === "crop"
            ? cropColor(f.cropPlan)
            : soilStatusColor(soilStatus(f.latestSoilTestDate ?? null));
          let sx = 0, sy = 0, n = 0;
          const polys = f.rings.map((ring, i) => {
            const points = ring
              .map(([lng, lat]) => {
                const p = project(lng, lat);
                sx += p.x; sy += p.y; n++;
                return `${p.x},${p.y}`;
              })
              .join(" ");
            return (
              <Polygon
                key={`p_${f.fieldId}_${i}`}
                points={points}
                fill={fill}
                fillOpacity={0.35}
                stroke={fill}
                strokeWidth={2}
              />
            );
          });
          const cx = n > 0 ? sx / n : width / 2;
          const cy = n > 0 ? sy / n : height / 2;
          const label = f.cropPlan ? `${f.fieldName} · ${f.cropPlan}` : f.fieldName;
          return (
            <React.Fragment key={`f_${f.fieldId}`}>
              {polys}
              <SvgText
                x={cx}
                y={cy + 4}
                fontSize={11}
                fontWeight="700"
                fill="#ffffff"
                stroke="#ffffff"
                strokeWidth={4}
                strokeLinejoin="round"
                textAnchor="middle"
              >
                {label}
              </SvgText>
              <SvgText
                x={cx}
                y={cy + 4}
                fontSize={11}
                fontWeight="600"
                fill="#111827"
                textAnchor="middle"
              >
                {label}
              </SvgText>
              {f.soilTestCount && f.soilTestCount > 0 ? (
                <>
                  <Circle cx={cx} cy={cy - 14} r={9} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
                  <SvgText
                    x={cx}
                    y={cy - 11}
                    fontSize={10}
                    fontWeight="700"
                    fill="#ffffff"
                    textAnchor="middle"
                  >
                    {String(f.soilTestCount)}
                  </SvgText>
                </>
              ) : null}
            </React.Fragment>
          );
        })}
      </Svg>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "#e5e7eb" },
  empty: { borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#f3f4f6" },
  emptyText: { fontSize: 12, color: "#6b7280", fontFamily: "Inter_400Regular" },
  attrib: { position: "absolute", bottom: 4, right: 4, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  attribText: { fontSize: 9, color: "#444" },
  expandBtn: { position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 },
  toggle: { flexDirection: "row", borderWidth: 1, borderRadius: 6, overflow: "hidden" },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  toggleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  modeLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 2, borderWidth: 1 },
  legendText: { fontSize: 10, color: "#4b5563", fontFamily: "Inter_400Regular" },
});

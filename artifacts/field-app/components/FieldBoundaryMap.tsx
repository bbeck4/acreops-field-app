import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import {
  BASE_LAYERS,
  BASE_LAYER_ORDER,
  TILE_SIZE,
  computeBounds,
  extractRings,
  fitZoom,
  latToTileY,
  lonToTileX,
  type BaseLayerId,
  type LngLat,
  type MapFeature,
} from "@/lib/mapTiles";
import { TileLayer } from "@/components/TileLayer";
import { FieldMapFullscreen } from "@/components/FieldMapFullscreen";

type Props = {
  geoJson: unknown;
  height?: number;
  borderColor: string;
  primaryColor: string;
};

export function FieldBoundaryMap({ geoJson, height = 220, borderColor, primaryColor }: Props) {
  const [width, setWidth] = React.useState(0);
  const [layerId, setLayerId] = React.useState<BaseLayerId>("streets");
  const [fullscreen, setFullscreen] = React.useState(false);
  const rings = React.useMemo(() => extractRings(geoJson), [geoJson]);

  const features = React.useMemo<MapFeature[]>(
    () => (rings.length > 0 ? [{ id: "boundary", rings, fill: primaryColor }] : []),
    [rings, primaryColor],
  );

  if (rings.length === 0) {
    return (
      <View style={[styles.empty, { borderColor, height }]}>
        <Text style={styles.emptyText}>No boundary geometry available</Text>
      </View>
    );
  }

  const bounds = width > 0 ? computeBounds(rings) : null;
  const layer = BASE_LAYERS[layerId];

  return (
    <View>
      <View style={styles.controls}>
        <View style={[styles.segment, { borderColor }]}>
          {BASE_LAYER_ORDER.map((id) => {
            const active = id === layerId;
            return (
              <Pressable
                key={id}
                onPress={() => setLayerId(id)}
                style={[styles.segmentBtn, active && { backgroundColor: primaryColor }]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${BASE_LAYERS[id].label} view`}
              >
                <Text style={[styles.segmentText, { color: active ? "#ffffff" : "#374151" }]}>
                  {BASE_LAYERS[id].label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.wrap, { borderColor, height }]}
      >
        {bounds && width > 0 ? (
          <BoundaryRender
            bounds={bounds}
            rings={rings}
            width={width}
            height={height}
            primaryColor={primaryColor}
            layerId={layerId}
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
          <Text style={styles.attribText}>{layer.attribution}</Text>
        </View>
      </View>
      <FieldMapFullscreen
        visible={fullscreen}
        onClose={() => setFullscreen(false)}
        features={features}
        primaryColor={primaryColor}
        title="Field Boundary"
        initialLayer={layerId}
      />
    </View>
  );
}

function BoundaryRender({
  bounds,
  rings,
  width,
  height,
  primaryColor,
  layerId,
}: {
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  rings: LngLat[][];
  width: number;
  height: number;
  primaryColor: string;
  layerId: BaseLayerId;
}) {
  const zoom = fitZoom(bounds, width, height);
  const cLng = (bounds.minLng + bounds.maxLng) / 2;
  const cLat = (bounds.minLat + bounds.maxLat) / 2;
  const layer = BASE_LAYERS[layerId];

  const cxPx = lonToTileX(cLng, zoom) * TILE_SIZE;
  const cyPx = latToTileY(cLat, zoom) * TILE_SIZE;
  const project = (lng: number, lat: number) => ({
    x: lonToTileX(lng, zoom) * TILE_SIZE - cxPx + width / 2,
    y: latToTileY(lat, zoom) * TILE_SIZE - cyPx + height / 2,
  });

  return (
    <>
      <TileLayer width={width} height={height} zoom={zoom} cLng={cLng} cLat={cLat} url={layer.tileUrl} />
      {layer.overlayUrl ? (
        <TileLayer width={width} height={height} zoom={zoom} cLng={cLng} cLat={cLat} url={layer.overlayUrl} />
      ) : null}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {rings.map((ring, i) => {
          const points = ring
            .map(([lng, lat]) => {
              const p = project(lng, lat);
              return `${p.x},${p.y}`;
            })
            .join(" ");
          return (
            <Polygon
              key={i}
              points={points}
              fill={primaryColor}
              fillOpacity={layer.imagery ? 0.2 : 0.25}
              stroke={layer.imagery ? "#ffffff" : primaryColor}
              strokeWidth={layer.imagery ? 2.5 : 2}
            />
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
  controls: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 6, overflow: "hidden" },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  segmentText: { fontSize: 11, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
});

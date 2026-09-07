import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  GestureResponderEvent,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TileLayer } from "@/components/TileLayer";
import {
  BASE_LAYERS,
  TILE_SIZE,
  computeBounds,
  fitZoom,
  latToTileY,
  lonToTileX,
  tileXToLon,
  tileYToLat,
} from "@/lib/mapTiles";

const HEIGHT = 240;
// A finger movement under this many pixels counts as a tap (select), not a drag (move).
const TAP_SLOP_PX = 6;

export type SamplePoint = {
  id: number;
  lat: number;
  lng: number;
  /** 1-based number shown on the marker. */
  index: number;
  selected?: boolean;
};

type Props = {
  points: SamplePoint[];
  onSelectPoint: (id: number) => void;
  onMovePoint: (id: number, lat: number, lng: number) => void;
  /** Tap on empty map space drops a new point at that location. */
  onAddPoint?: (lat: number, lng: number) => void;
  primaryColor: string;
  borderColor: string;
  cardColor: string;
  mutedColor: string;
};

type LayerId = "satellite" | "streets";

/**
 * A compact, fit-to-bounds tile map that renders every captured sample point as a
 * numbered marker. The map itself is static (no pan) so each marker can own its own
 * drag gesture without a tap/pan conflict: a tap selects the point, a drag repositions
 * it. Mirrors the raster-tile stack used by the other custom maps (no react-native-maps).
 */
export function SamplePointsMap({
  points,
  onSelectPoint,
  onMovePoint,
  onAddPoint,
  primaryColor,
  borderColor,
  cardColor,
  mutedColor,
}: Props) {
  const [width, setWidth] = React.useState(0);
  const [layer, setLayer] = React.useState<LayerId>("satellite");
  // Live pixel offset of the marker currently being dragged.
  const [drag, setDrag] = React.useState<{ id: number; dx: number; dy: number } | null>(null);

  const base = layer === "satellite" ? BASE_LAYERS.hybrid : BASE_LAYERS.streets;

  // Fit all points within the viewport.
  const { cLat, cLng, zoom } = React.useMemo(() => {
    if (points.length === 0) return { cLat: 0, cLng: 0, zoom: 14 };
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    if (points.length === 1 || width === 0) {
      return { cLat: centerLat, cLng: centerLng, zoom: 16 };
    }
    const bounds = computeBounds([points.map((p) => [p.lng, p.lat] as [number, number])]);
    const z = bounds ? fitZoom(bounds, width, HEIGHT, 18) : 16;
    return { cLat: centerLat, cLng: centerLng, zoom: z };
  }, [points, width]);

  // Project a geographic coordinate to a pixel position within the map view.
  const project = React.useCallback(
    (lat: number, lng: number) => {
      const centerPxX = lonToTileX(cLng, zoom) * TILE_SIZE;
      const centerPxY = latToTileY(cLat, zoom) * TILE_SIZE;
      const px = width / 2 + (lonToTileX(lng, zoom) * TILE_SIZE - centerPxX);
      const py = HEIGHT / 2 + (latToTileY(lat, zoom) * TILE_SIZE - centerPxY);
      return { px, py };
    },
    [cLat, cLng, zoom, width],
  );

  // Invert a pixel position back to a geographic coordinate.
  const unproject = React.useCallback(
    (px: number, py: number) => {
      const centerPxX = lonToTileX(cLng, zoom) * TILE_SIZE;
      const centerPxY = latToTileY(cLat, zoom) * TILE_SIZE;
      const lng = tileXToLon((centerPxX + (px - width / 2)) / TILE_SIZE, zoom);
      const lat = tileYToLat((centerPxY + (py - HEIGHT / 2)) / TILE_SIZE, zoom);
      return { lat, lng };
    },
    [cLat, cLng, zoom, width],
  );

  return (
    <View style={[styles.wrap, { borderColor, height: HEIGHT }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <>
          <TileLayer width={width} height={HEIGHT} zoom={zoom} cLng={cLng} cLat={cLat} url={base.tileUrl} />
          {base.overlayUrl ? (
            <TileLayer width={width} height={HEIGHT} zoom={zoom} cLng={cLng} cLat={cLat} url={base.overlayUrl} />
          ) : null}

          {/* Tap-catcher sits above the tiles but below the markers, so tapping a
              marker still hits the marker's own gesture, while tapping empty space
              drops a new point at that location. */}
          {onAddPoint ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={(e: GestureResponderEvent) => {
                const { locationX, locationY } = e.nativeEvent;
                const { lat, lng } = unproject(locationX, locationY);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onAddPoint(lat, lng);
              }}
            />
          ) : null}

          {points.map((p) => (
            <DraggableMarker
              key={p.id}
              point={p}
              project={project}
              unproject={unproject}
              dragging={drag?.id === p.id ? drag : null}
              onDragChange={setDrag}
              onSelect={onSelectPoint}
              onMove={onMovePoint}
              primaryColor={primaryColor}
            />
          ))}
        </>
      ) : null}

      <View style={[styles.layerToggle, { borderColor }]}>
        <Pressable
          onPress={() => setLayer("satellite")}
          style={[styles.layerBtn, layer === "satellite" && { backgroundColor: primaryColor }]}
        >
          <Text style={[styles.layerText, { color: layer === "satellite" ? "#fff" : mutedColor }]}>Satellite</Text>
        </Pressable>
        <Pressable
          onPress={() => setLayer("streets")}
          style={[styles.layerBtn, layer === "streets" && { backgroundColor: primaryColor }]}
        >
          <Text style={[styles.layerText, { color: layer === "streets" ? "#fff" : mutedColor }]}>Streets</Text>
        </Pressable>
      </View>

      <View pointerEvents="none" style={[styles.hint, { backgroundColor: cardColor, borderColor }]}>
        <Feather name="move" size={11} color={primaryColor} />
        <Text style={[styles.hintText, { color: primaryColor }]}>
          {onAddPoint ? "Tap map to add · pin to edit · drag to move" : "Tap a pin to edit · drag to move"}
        </Text>
      </View>

      <View pointerEvents="none" style={styles.attrib}>
        <Text style={styles.attribText}>{base.attribution}</Text>
      </View>
    </View>
  );
}

function DraggableMarker({
  point,
  project,
  unproject,
  dragging,
  onDragChange,
  onSelect,
  onMove,
  primaryColor,
}: {
  point: SamplePoint;
  project: (lat: number, lng: number) => { px: number; py: number };
  unproject: (px: number, py: number) => { lat: number; lng: number };
  dragging: { id: number; dx: number; dy: number } | null;
  onDragChange: (d: { id: number; dx: number; dy: number } | null) => void;
  onSelect: (id: number) => void;
  onMove: (id: number, lat: number, lng: number) => void;
  primaryColor: string;
}) {
  const { px, py } = project(point.lat, point.lng);
  // Keep the latest projection in a ref so the gesture closure reads fresh values.
  const baseRef = React.useRef({ px, py });
  baseRef.current = { px, py };

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e: GestureResponderEvent, g: PanResponderGestureState) =>
          Math.abs(g.dx) > TAP_SLOP_PX || Math.abs(g.dy) > TAP_SLOP_PX,
        onPanResponderGrant: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        },
        onPanResponderMove: (_e, g) => {
          onDragChange({ id: point.id, dx: g.dx, dy: g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          const moved = Math.abs(g.dx) > TAP_SLOP_PX || Math.abs(g.dy) > TAP_SLOP_PX;
          onDragChange(null);
          if (moved) {
            const { lat, lng } = unproject(baseRef.current.px + g.dx, baseRef.current.py + g.dy);
            onMove(point.id, lat, lng);
          } else {
            onSelect(point.id);
          }
        },
        onPanResponderTerminate: () => onDragChange(null),
      }),
    [point.id, onDragChange, onSelect, onMove, unproject],
  );

  const dx = dragging?.dx ?? 0;
  const dy = dragging?.dy ?? 0;
  const left = px + dx - 16;
  const top = py + dy - 30;
  const active = point.selected || dragging != null;

  return (
    <View style={[styles.marker, { left, top }]} {...panResponder.panHandlers}>
      <View style={[styles.markerPin, { backgroundColor: active ? primaryColor : "#ffffff", borderColor: primaryColor }]}>
        <Text style={[styles.markerText, { color: active ? "#ffffff" : primaryColor }]}>{point.index}</Text>
      </View>
      <View style={[styles.markerTail, { borderTopColor: primaryColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e8eef2",
  },
  marker: { position: "absolute", width: 32, alignItems: "center" },
  markerPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  markerText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  markerTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  layerToggle: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  layerBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  layerText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  hint: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  hintText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  attrib: {
    position: "absolute",
    bottom: 2,
    right: 4,
    paddingHorizontal: 4,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 3,
  },
  attribText: { fontSize: 9, color: "#333" },
});

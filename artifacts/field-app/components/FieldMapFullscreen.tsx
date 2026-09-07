import React from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Polygon, Text as SvgText } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import {
  BASE_LAYERS,
  BASE_LAYER_ORDER,
  TILE_SIZE,
  computeBounds,
  fitZoom,
  latToTileY,
  lonToTileX,
  tileXToLon,
  tileYToLat,
  type BaseLayerId,
  type MapFeature,
} from "@/lib/mapTiles";
import { TileLayer } from "@/components/TileLayer";

const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

function touchDistance(touches: GestureResponderEvent["nativeEvent"]["touches"]) {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  features: MapFeature[];
  primaryColor: string;
  title?: string;
  initialLayer?: BaseLayerId;
};

export function FieldMapFullscreen({
  visible,
  onClose,
  features,
  primaryColor,
  title,
  initialLayer = "satellite",
}: Props) {
  const insets = useSafeAreaInsets();
  const [layerId, setLayerId] = React.useState<BaseLayerId>(initialLayer);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [zoom, setZoom] = React.useState(14);
  const [center, setCenter] = React.useState<{ lng: number; lat: number }>({ lng: 0, lat: 0 });

  const zoomRef = React.useRef(zoom);
  const centerRef = React.useRef(center);
  zoomRef.current = zoom;
  centerRef.current = center;

  const sizeRef = React.useRef(size);
  sizeRef.current = size;

  // Live transform applied to the map content during a pinch gesture. The map
  // keeps integer tile zoom; the pinch scales the rendered content smoothly and
  // commits to the nearest tile zoom (anchored on the pinch focal point) on
  // release, so it feels like a native pinch-to-zoom.
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const txAnim = React.useRef(new Animated.Value(0)).current;
  const tyAnim = React.useRef(new Animated.Value(0)).current;

  const commitPinch = React.useCallback(
    (scale: number, focalX: number, focalY: number, snapZoom: number, snapLng: number, snapLat: number) => {
      const { width: w, height: h } = sizeRef.current;
      scaleAnim.setValue(1);
      txAnim.setValue(0);
      tyAnim.setValue(0);
      if (!w || !h) return;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(snapZoom + Math.log2(scale))));
      // Geographic coordinate currently under the pinch focal point.
      const worldX = lonToTileX(snapLng, snapZoom) * TILE_SIZE + (focalX - w / 2);
      const worldY = latToTileY(snapLat, snapZoom) * TILE_SIZE + (focalY - h / 2);
      const focalLng = tileXToLon(worldX / TILE_SIZE, snapZoom);
      const focalLat = tileYToLat(worldY / TILE_SIZE, snapZoom);
      // Recenter so that focal coordinate stays under the focal point at newZoom.
      const ncX = lonToTileX(focalLng, newZoom) * TILE_SIZE + (w / 2 - focalX);
      const ncY = latToTileY(focalLat, newZoom) * TILE_SIZE + (h / 2 - focalY);
      const newLng = tileXToLon(ncX / TILE_SIZE, newZoom);
      const newLat = Math.max(-85.0511, Math.min(85.0511, tileYToLat(ncY / TILE_SIZE, newZoom)));
      zoomRef.current = newZoom;
      centerRef.current = { lng: newLng, lat: newLat };
      setZoom(newZoom);
      setCenter({ lng: newLng, lat: newLat });
    },
    [scaleAnim, txAnim, tyAnim],
  );

  const allRings = React.useMemo(() => features.flatMap((f) => f.rings), [features]);
  const bounds = React.useMemo(() => computeBounds(allRings), [allRings]);

  // Fit to the features whenever the modal opens or its size is first known.
  const initRef = React.useRef(false);
  React.useEffect(() => {
    if (!visible) {
      initRef.current = false;
      setLayerId(initialLayer);
      return;
    }
    if (initRef.current || size.width === 0 || size.height === 0 || !bounds) return;
    const cLng = (bounds.minLng + bounds.maxLng) / 2;
    const cLat = (bounds.minLat + bounds.maxLat) / 2;
    setCenter({ lng: cLng, lat: cLat });
    setZoom(fitZoom(bounds, size.width, size.height, MAX_ZOOM));
    initRef.current = true;
  }, [visible, size.width, size.height, bounds, initialLayer]);

  const shiftCenter = React.useCallback((dxPx: number, dyPx: number) => {
    const z = zoomRef.current;
    const c = centerRef.current;
    const tileX = lonToTileX(c.lng, z) - dxPx / TILE_SIZE;
    const tileY = latToTileY(c.lat, z) - dyPx / TILE_SIZE;
    // Clamp latitude to Web Mercator practical limits to avoid blanking near the poles.
    const lat = Math.max(-85.0511, Math.min(85.0511, tileYToLat(tileY, z)));
    const next = { lng: tileXToLon(tileX, z), lat };
    centerRef.current = next;
    setCenter(next);
  }, []);

  const changeZoom = React.useCallback((delta: number) => {
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
  }, []);

  const beginPinch = React.useCallback(
    (touches: GestureResponderEvent["nativeEvent"]["touches"]) => {
      gesture.mode = "pinch";
      gesture.startDist = touchDistance(touches) || 1;
      gesture.focalX = (touches[0].locationX + touches[1].locationX) / 2;
      gesture.focalY = (touches[0].locationY + touches[1].locationY) / 2;
      gesture.snapZoom = zoomRef.current;
      gesture.snapLng = centerRef.current.lng;
      gesture.snapLat = centerRef.current.lat;
      gesture.scale = 1;
      scaleAnim.setValue(1);
      txAnim.setValue(0);
      tyAnim.setValue(0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scaleAnim, txAnim, tyAnim],
  );

  const gesture = React.useRef({
    mode: "none" as "none" | "pan" | "pinch",
    lastX: 0,
    lastY: 0,
    startDist: 0,
    focalX: 0,
    focalY: 0,
    scale: 1,
    snapZoom: 14,
    snapLng: 0,
    snapLat: 0,
  }).current;

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const t = e.nativeEvent.touches;
          if (t.length >= 2) {
            beginPinch(t);
          } else {
            gesture.mode = "pan";
            gesture.lastX = e.nativeEvent.pageX;
            gesture.lastY = e.nativeEvent.pageY;
          }
        },
        onPanResponderMove: (e) => {
          const t = e.nativeEvent.touches;
          if (t.length >= 2) {
            if (gesture.mode !== "pinch" || gesture.startDist === 0) {
              beginPinch(t);
              return;
            }
            const d = touchDistance(t);
            const s = Math.max(0.25, Math.min(6, d / gesture.startDist));
            gesture.scale = s;
            const { width: w, height: h } = sizeRef.current;
            scaleAnim.setValue(s);
            txAnim.setValue((gesture.focalX - w / 2) * (1 - s));
            tyAnim.setValue((gesture.focalY - h / 2) * (1 - s));
          } else if (t.length === 1) {
            const { pageX, pageY } = e.nativeEvent;
            // Finger lifted from a pinch: commit the zoom, then pan with the rest.
            if (gesture.mode === "pinch") {
              commitPinch(gesture.scale, gesture.focalX, gesture.focalY, gesture.snapZoom, gesture.snapLng, gesture.snapLat);
              gesture.mode = "pan";
              gesture.lastX = pageX;
              gesture.lastY = pageY;
              return;
            }
            if (gesture.mode !== "pan") {
              gesture.mode = "pan";
              gesture.lastX = pageX;
              gesture.lastY = pageY;
              return;
            }
            const dx = pageX - gesture.lastX;
            const dy = pageY - gesture.lastY;
            gesture.lastX = pageX;
            gesture.lastY = pageY;
            if (dx !== 0 || dy !== 0) shiftCenter(dx, dy);
          }
        },
        onPanResponderRelease: () => {
          if (gesture.mode === "pinch") {
            commitPinch(gesture.scale, gesture.focalX, gesture.focalY, gesture.snapZoom, gesture.snapLng, gesture.snapLat);
          }
          gesture.mode = "none";
          gesture.startDist = 0;
        },
        onPanResponderTerminate: () => {
          if (gesture.mode === "pinch") {
            commitPinch(gesture.scale, gesture.focalX, gesture.focalY, gesture.snapZoom, gesture.snapLng, gesture.snapLat);
          }
          gesture.mode = "none";
          gesture.startDist = 0;
        },
      }),
    [gesture, beginPinch, commitPinch, shiftCenter, scaleAnim, txAnim, tyAnim],
  );

  const layer = BASE_LAYERS[layerId];
  const { width, height } = size;
  const ready = width > 0 && height > 0 && initRef.current;

  const project = React.useCallback(
    (lng: number, lat: number) => {
      const cxPx = lonToTileX(center.lng, zoom) * TILE_SIZE;
      const cyPx = latToTileY(center.lat, zoom) * TILE_SIZE;
      return {
        x: lonToTileX(lng, zoom) * TILE_SIZE - cxPx + width / 2,
        y: latToTileY(lat, zoom) * TILE_SIZE - cyPx + height / 2,
      };
    },
    [center, zoom, width, height],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View
          style={styles.mapArea}
          onLayout={(e) =>
            setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
          }
          {...responder.panHandlers}
        >
          {ready ? (
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { transform: [{ translateX: txAnim }, { translateY: tyAnim }, { scale: scaleAnim }] },
              ]}
            >
              <TileLayer width={width} height={height} zoom={zoom} cLng={center.lng} cLat={center.lat} url={layer.tileUrl} />
              {layer.overlayUrl ? (
                <TileLayer
                  width={width}
                  height={height}
                  zoom={zoom}
                  cLng={center.lng}
                  cLat={center.lat}
                  url={layer.overlayUrl}
                />
              ) : null}
              <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
                {features.map((f) => {
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
                        key={`${f.id}_${i}`}
                        points={points}
                        fill={f.fill}
                        fillOpacity={0.3}
                        stroke={f.fill}
                        strokeWidth={2.5}
                      />
                    );
                  });
                  const cx = n > 0 ? sx / n : width / 2;
                  const cy = n > 0 ? sy / n : height / 2;
                  return (
                    <React.Fragment key={f.id}>
                      {polys}
                      {f.label ? (
                        <>
                          <SvgText x={cx} y={cy + 4} fontSize={13} fontWeight="700" fill="#ffffff" stroke="#ffffff" strokeWidth={4} strokeLinejoin="round" textAnchor="middle">
                            {f.label}
                          </SvgText>
                          <SvgText x={cx} y={cy + 4} fontSize={13} fontWeight="700" fill="#111827" textAnchor="middle">
                            {f.label}
                          </SvgText>
                        </>
                      ) : null}
                      {f.badge && f.badge > 0 ? (
                        <>
                          <Circle cx={cx} cy={cy - 16} r={10} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
                          <SvgText x={cx} y={cy - 12} fontSize={11} fontWeight="700" fill="#ffffff" textAnchor="middle">
                            {String(f.badge)}
                          </SvgText>
                        </>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </Svg>
            </Animated.View>
          ) : null}

          {/* Attribution */}
          <View pointerEvents="none" style={styles.attrib}>
            <Text style={styles.attribText}>{layer.attribution}</Text>
          </View>
        </View>

        {/* Top bar */}
        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close map">
            <Feather name="x" size={22} color="#111827" />
          </Pressable>
          {title ? (
            <View style={styles.titlePill} pointerEvents="none">
              <Text numberOfLines={1} style={styles.titleText}>{title}</Text>
            </View>
          ) : null}
        </View>

        {/* Layer selector */}
        <View style={[styles.layerBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <View style={styles.segment}>
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

        {/* Zoom controls */}
        <View style={[styles.zoomControls, { bottom: insets.bottom + 24 }]} pointerEvents="box-none">
          <Pressable
            onPress={() => changeZoom(1)}
            style={[styles.zoomBtn, styles.zoomBtnTop, zoom >= MAX_ZOOM && styles.zoomBtnDisabled]}
            disabled={zoom >= MAX_ZOOM}
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
          >
            <Feather name="plus" size={22} color="#111827" />
          </Pressable>
          <Pressable
            onPress={() => changeZoom(-1)}
            style={[styles.zoomBtn, zoom <= MIN_ZOOM && styles.zoomBtnDisabled]}
            disabled={zoom <= MIN_ZOOM}
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
          >
            <Feather name="minus" size={22} color="#111827" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#e5e7eb" },
  mapArea: { flex: 1, overflow: "hidden", backgroundColor: "#e5e7eb" },
  attrib: { position: "absolute", bottom: 4, right: 4, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  attribText: { fontSize: 9, color: "#444" },
  topBar: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  titlePill: { flexShrink: 1, backgroundColor: "rgba(255,255,255,0.95)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  titleText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600", color: "#111827" },
  layerBar: { position: "absolute", right: 12, alignItems: "flex-end" },
  segment: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 10, overflow: "hidden", marginTop: 48, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  segmentText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  zoomControls: { position: "absolute", right: 12, borderRadius: 12, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  zoomBtn: { width: 44, height: 44, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center" },
  zoomBtnTop: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#d1d5db" },
  zoomBtnDisabled: { opacity: 0.4 },
});

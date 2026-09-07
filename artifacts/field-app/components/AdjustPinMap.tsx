import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Image, PanResponder, StyleSheet, Text, View } from "react-native";

const TILE_SIZE = 256;
const ZOOM = 16;
const HEIGHT = 220;

function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileXToLon(x: number, z: number) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tileYToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

type Props = {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  primaryColor: string;
  borderColor: string;
};

export function AdjustPinMap({ lat, lng, onChange, primaryColor, borderColor }: Props) {
  const [width, setWidth] = React.useState(0);
  const dragStartRef = React.useRef<{ lat: number; lng: number } | null>(null);

  const xExact = lonToTileX(lng, ZOOM);
  const yExact = latToTileY(lat, ZOOM);
  const tileX = Math.floor(xExact);
  const tileY = Math.floor(yExact);
  const fracX = xExact - tileX;
  const fracY = yExact - tileY;
  const maxTile = Math.pow(2, ZOOM);

  const offsetX = width / 2 - fracX * TILE_SIZE;
  const offsetY = HEIGHT / 2 - fracY * TILE_SIZE;

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartRef.current = { lat, lng };
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        },
        onPanResponderMove: (_e, g) => {
          const start = dragStartRef.current;
          if (!start) return;
          const startX = lonToTileX(start.lng, ZOOM);
          const startY = latToTileY(start.lat, ZOOM);
          const newX = startX - g.dx / TILE_SIZE;
          const newY = startY - g.dy / TILE_SIZE;
          const newLng = tileXToLon(newX, ZOOM);
          const newLat = tileYToLat(newY, ZOOM);
          onChange(newLat, newLng);
        },
        onPanResponderRelease: () => {
          dragStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragStartRef.current = null;
        },
      }),
    [lat, lng, onChange]
  );

  const offsets = [-1, 0, 1];

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.wrap, { borderColor, height: HEIGHT }]}
      {...panResponder.panHandlers}
    >
      <View style={StyleSheet.absoluteFill}>
        {width > 0
          ? offsets.map((dy) =>
              offsets.map((dx) => {
                const ty = tileY + dy;
                if (ty < 0 || ty >= maxTile) return null;
                const wrappedX = (((tileX + dx) % maxTile) + maxTile) % maxTile;
                return (
                  <Image
                    key={`${dx}_${dy}`}
                    source={{
                      uri: `https://tile.openstreetmap.org/${ZOOM}/${wrappedX}/${ty}.png`,
                    }}
                    style={{
                      position: "absolute",
                      left: offsetX + dx * TILE_SIZE,
                      top: offsetY + dy * TILE_SIZE,
                      width: TILE_SIZE,
                      height: TILE_SIZE,
                    }}
                  />
                );
              })
            )
          : null}
      </View>

      <View
        pointerEvents="none"
        style={[styles.pinWrap, { left: width / 2 - 14, top: HEIGHT / 2 - 26 }]}
      >
        <Feather name="map-pin" size={28} color={primaryColor} />
      </View>

      <View pointerEvents="none" style={[styles.hint, { borderColor }]}>
        <Feather name="move" size={11} color={primaryColor} />
        <Text style={[styles.hintText, { color: primaryColor }]}>Drag map to adjust</Text>
      </View>

      <View pointerEvents="none" style={styles.attrib}>
        <Text style={styles.attribText}>© OpenStreetMap</Text>
      </View>
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
  pinWrap: { position: "absolute" },
  hint: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.92)",
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

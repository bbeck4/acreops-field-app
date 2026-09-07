import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { openNavigation } from "@/lib/navigation";

const TILE_SIZE = 256;
const ZOOM = 14;
const HEIGHT = 160;

function lonToTileX(lon: number, z: number) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

function latToTileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}

type Props = {
  lat: number;
  lng: number;
  label?: string;
  primaryColor: string;
  borderColor: string;
};

export function CustomerMapPreview({ lat, lng, label, primaryColor, borderColor }: Props) {
  const [width, setWidth] = React.useState(0);

  const xExact = lonToTileX(lng, ZOOM);
  const yExact = latToTileY(lat, ZOOM);
  const tileX = Math.floor(xExact);
  const tileY = Math.floor(yExact);
  const fracX = xExact - tileX;
  const fracY = yExact - tileY;
  const maxTile = Math.pow(2, ZOOM);

  const offsetX = width / 2 - fracX * TILE_SIZE;
  const offsetY = HEIGHT / 2 - fracY * TILE_SIZE;

  const openMaps = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void openNavigation({ lat, lng, label: label ?? "Customer location" });
  };

  const offsets = [-1, 0, 1];

  return (
    <Pressable
      onPress={openMaps}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.wrap, { borderColor, height: HEIGHT }]}
      accessibilityRole="button"
      accessibilityLabel="Open customer location in maps"
    >
      <View style={StyleSheet.absoluteFill}>
        {width > 0
          ? offsets.map((dy) =>
              offsets.map((dx) => {
                const ty = tileY + dy;
                if (ty < 0 || ty >= maxTile) return null;
                const wrappedX = ((tileX + dx) % maxTile + maxTile) % maxTile;
                return (
                  <Image
                    key={`${dx}_${dy}`}
                    source={{ uri: `https://tile.openstreetmap.org/${ZOOM}/${wrappedX}/${ty}.png` }}
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

      <View pointerEvents="none" style={[styles.chip, { borderColor }]}>
        <Feather name="navigation" size={11} color={primaryColor} />
        <Text style={[styles.chipText, { color: primaryColor }]}>Directions</Text>
      </View>

      <View pointerEvents="none" style={styles.attrib}>
        <Text style={styles.attribText}>© OpenStreetMap</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    marginHorizontal: 16,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e8eef2",
  },
  pinWrap: { position: "absolute" },
  chip: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 11 },
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

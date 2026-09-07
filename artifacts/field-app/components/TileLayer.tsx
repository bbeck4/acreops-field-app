import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { TILE_SIZE, lonToTileX, latToTileY } from "@/lib/mapTiles";

type Props = {
  width: number;
  height: number;
  zoom: number;
  cLng: number;
  cLat: number;
  url: (z: number, x: number, y: number) => string;
  opacity?: number;
};

/** Renders an OSM/XYZ raster-tile grid centered on (cLng, cLat) at integer `zoom`. */
export function TileLayer({ width, height, zoom, cLng, cLat, url, opacity = 1 }: Props) {
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
      const wrappedX = (((centerTileX + dx) % maxTile) + maxTile) % maxTile;
      tiles.push(
        <Image
          key={`${dx}_${dy}`}
          source={{ uri: url(zoom, wrappedX, ty) }}
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

  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>{tiles}</View>;
}

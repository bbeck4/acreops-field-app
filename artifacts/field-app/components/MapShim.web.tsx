import React from "react";
import { View, Text, StyleSheet } from "react-native";

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const PROVIDER_DEFAULT = undefined;

type MapViewProps = {
  style?: any;
  initialRegion?: Region;
  provider?: unknown;
  onPress?: () => void;
  children?: React.ReactNode;
};

const MapView: React.FC<MapViewProps> = ({ style, children }) => (
  <View style={[styles.fallback, style]}>
    <Text style={styles.title}>Map view</Text>
    <Text style={styles.subtitle}>
      The interactive map is only available in the iOS / Android app. Switch to the list view to see your stops here.
    </Text>
    {children}
  </View>
);

type MarkerProps = {
  coordinate: { latitude: number; longitude: number };
  onPress?: (e: { stopPropagation?: () => void }) => void;
  children?: React.ReactNode;
};

export const Marker: React.FC<MarkerProps> = () => null;

type PolylineProps = {
  coordinates: Array<{ latitude: number; longitude: number }>;
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
};

export const Polyline: React.FC<PolylineProps> = () => null;

type CalloutProps = {
  onPress?: (e?: any) => void;
  children?: React.ReactNode;
};

export const Callout: React.FC<CalloutProps> = () => null;

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
    padding: 24,
  },
  title: { fontSize: 16, fontWeight: "600", color: "#0f172a", marginBottom: 6 },
  subtitle: { fontSize: 13, color: "#64748b", textAlign: "center", maxWidth: 320 },
});

export default MapView;

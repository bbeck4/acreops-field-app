import type * as React from "react";

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const PROVIDER_DEFAULT: unknown;

export interface MapViewProps {
  style?: any;
  initialRegion?: Region;
  region?: Region;
  provider?: unknown;
  onPress?: (e?: any) => void;
  showsUserLocation?: boolean;
  children?: React.ReactNode;
  [key: string]: any;
}

declare const MapView: React.FC<MapViewProps>;
export default MapView;

export interface MarkerProps {
  coordinate: { latitude: number; longitude: number };
  onPress?: (e: { stopPropagation?: () => void }) => void;
  title?: string;
  children?: React.ReactNode;
  [key: string]: any;
}
export const Marker: React.FC<MarkerProps>;

export interface PolylineProps {
  coordinates: Array<{ latitude: number; longitude: number }>;
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
  [key: string]: any;
}
export const Polyline: React.FC<PolylineProps>;

export interface CalloutProps {
  onPress?: (e?: any) => void;
  children?: React.ReactNode;
  [key: string]: any;
}
export const Callout: React.FC<CalloutProps>;

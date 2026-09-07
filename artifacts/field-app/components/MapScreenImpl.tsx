import { Feather, FontAwesome } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Callout, Marker, PROVIDER_DEFAULT, UrlTile, WMSTile, Polygon, Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CustomerMapPin,
  getListCustomerMapPinsQueryKey,
  ListCustomerMapPinsParams,
  useListCustomerMapPins,
  useGetCustomerMapUsdaMetadata,
  useGetCustomerMapUsdaProduction,
  getGetCustomerMapUsdaProductionQueryKey,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QuickLogFab } from "@/components/QuickLogFab";
import { useAppAuth } from "@/context/AuthContext";
import { useOffline } from "@/context/OfflineContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";
import { usePermissions } from "@/lib/permissions";
import { BASE_LAYERS, BASE_LAYER_ORDER, BaseLayerId, extractPolygons } from "@/lib/mapTiles";
import {
  Audience,
  EMPTY_FILTER_STATE,
  audienceOptionsForUser,
  buildMapPinsParams,
  canShowProspects,
  effectiveAudience,
  filterPinsByAudience,
  isFilterStateDefault,
  MARKER_BOX,
  mapPinsCacheKey,
  markerGlyphSize,
  markerVisualKey,
  validateAcreageFilters,
  type CustomerMapFilterInput,
  type CustomerMapFilterState,
} from "@/lib/customerMap";

type ColorMode = "territory" | "mine";

const TERRITORY_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const UNASSIGNED_COLOR = "#6b7280";
const MINE_COLOR = "#16a34a";
const OTHER_COLOR = "#94a3b8";

const AUDIENCE_LABELS: Record<Audience, string> = {
  both: "Both",
  customers: "Customers",
  prospects: "Prospects",
};

function colorForTerritory(territory: string | null | undefined, territories: string[]) {
  if (!territory) return UNASSIGNED_COLOR;
  const idx = territories.indexOf(territory);
  if (idx < 0) return UNASSIGNED_COLOR;
  return TERRITORY_COLORS[idx % TERRITORY_COLORS.length];
}

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isOnline } = useOffline();
  const { currentMember } = useAppAuth();
  const { canDo } = usePermissions();

  // Prospect access: server permission gate. Never leak prospect pins to a user
  // without `prospects.view`, even from a stale cache — enforced both when
  // building the request and when rendering pins.
  const canProspects = canShowProspects({ hasProspectPermission: canDo("prospects.view") });

  const [mineOnly, setMineOnly] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("territory");
  const [sizeByAcreage, setSizeByAcreage] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<CustomerMapFilterState>(EMPTY_FILTER_STATE);
  const [locationPollingActive, setLocationPollingActive] = useState(false);
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);

  // --- Map Layers & USDA State ---
  const [layersOpen, setLayersOpen] = useState(false);
  const [baseLayer, setBaseLayer] = useState<BaseLayerId>("streets");
  const [usdaLayer, setUsdaLayer] = useState<"none" | "production" | "coverage">("none");
  const [usdaCrop, setUsdaCrop] = useState<"corn" | "soybeans">("corn");
  const [usdaYear, setUsdaYear] = useState<number | undefined>();
  const [usdaOpacity, setUsdaOpacity] = useState<number>(0.5);
  const [debouncedRegion, setDebouncedRegion] = useState<Region | null>(null);
  const regionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectedCounty, setSelectedCounty] = useState<{name: string, bushels: number, coordinate: {latitude: number, longitude: number}} | null>(null);

  const repId = mineOnly && currentMember?.id ? currentMember.id : undefined;

  const filterInput: CustomerMapFilterInput = useMemo(
    () => ({
      audience: filters.audience,
      county: filters.county,
      zip: filters.zip,
      minAcres: filters.minAcres,
      maxAcres: filters.maxAcres,
      repId,
    }),
    [filters, repId]
  );

  // Full canonical query params for GET /customers/map: audience + county/zip +
  // min/max acres (+ backward-compatible includeProspects) + repId.
  const params = useMemo(
    () => buildMapPinsParams(filterInput, canProspects) as ListCustomerMapPinsParams,
    [filterInput, canProspects]
  );

  const acreageFilterError = validateAcreageFilters(filterInput);
  const mapAudience = effectiveAudience(filters.audience, canProspects);
  const shouldPollForLocationEnrichment =
    isOnline && (mapAudience !== "customers" || filters.county.trim() !== "");
  useEffect(() => {
    if (!shouldPollForLocationEnrichment) {
      setLocationPollingActive(false);
      return;
    }
    setLocationPollingActive(true);
    const timer = setTimeout(() => setLocationPollingActive(false), 6 * 60_000);
    return () => clearTimeout(timer);
  }, [shouldPollForLocationEnrichment, mapAudience, filters.county]);
  const { data: livePins, isLoading, refetch, isRefetching } = useListCustomerMapPins(params, {
    query: {
      queryKey: getListCustomerMapPinsQueryKey(params),
      enabled: acreageFilterError == null,
      refetchInterval: locationPollingActive ? 15_000 : false,
    },
  });

  // --- USDA Data fetching ---
  const {
    data: usdaMetadata,
    isLoading: isUsdaMetadataLoading,
    error: usdaMetadataError,
  } = useGetCustomerMapUsdaMetadata();

  useEffect(() => {
    if (usdaMetadata && !usdaYear && usdaMetadata.defaultYear) {
      setUsdaYear(usdaMetadata.defaultYear);
    }
  }, [usdaMetadata, usdaYear]);

  const productionBounds = useMemo(() => {
    if (!debouncedRegion) return null;
    return {
      west: debouncedRegion.longitude - debouncedRegion.longitudeDelta / 2,
      east: debouncedRegion.longitude + debouncedRegion.longitudeDelta / 2,
      south: debouncedRegion.latitude - debouncedRegion.latitudeDelta / 2,
      north: debouncedRegion.latitude + debouncedRegion.latitudeDelta / 2,
    };
  }, [debouncedRegion]);

  const {
    data: productionData,
    isFetching: isProductionFetching,
    error: productionError,
  } = useGetCustomerMapUsdaProduction(
    {
      west: productionBounds?.west ?? 0,
      east: productionBounds?.east ?? 0,
      south: productionBounds?.south ?? 0,
      north: productionBounds?.north ?? 0,
      crop: usdaCrop,
      year: usdaYear ?? 0,
    },
    {
      query: {
        enabled: usdaLayer === "production" && productionBounds !== null && usdaYear != null,
        queryKey: getGetCustomerMapUsdaProductionQueryKey({
          west: productionBounds?.west ?? 0,
          east: productionBounds?.east ?? 0,
          south: productionBounds?.south ?? 0,
          north: productionBounds?.north ?? 0,
          crop: usdaCrop,
          year: usdaYear ?? 0,
        }),
        retry: false,
      },
    }
  );

  const handleRegionChangeComplete = (region: Region) => {
    if (regionTimer.current) clearTimeout(regionTimer.current);
    regionTimer.current = setTimeout(() => {
      setDebouncedRegion(region);
    }, 500);
  };

  useEffect(() => {
    setSelectedCounty(null);
  }, [usdaLayer, usdaCrop, usdaYear]);

  const maxProduction = useMemo(() => {
    if (!productionData) return 0;
    return Math.max(0, ...productionData.counties.map(c => c.productionBushels));
  }, [productionData]);

  const selectedUsdaCrop = usdaMetadata?.crops.find((crop) => crop.id === usdaCrop);
  const usdaLayerError =
    usdaMetadataError instanceof Error
      ? usdaMetadataError.message
      : productionError instanceof Error
        ? productionError.message
        : usdaMetadataError || productionError
          ? "USDA map data is temporarily unavailable."
          : null;

  const productionPolygons = useMemo(() => {
    if (!productionData || maxProduction === 0) return [];
    const cropMeta = usdaMetadata?.crops.find(c => c.id === usdaCrop);
    const baseColor = cropMeta?.color || "#ffffff";

    const r = parseInt(baseColor.slice(1,3), 16) || 0;
    const g = parseInt(baseColor.slice(3,5), 16) || 0;
    const b = parseInt(baseColor.slice(5,7), 16) || 0;

    return productionData.counties.flatMap((county) => {
      const polygons = extractPolygons(county.geometry);
      const intensity = Math.max(0.1, county.productionBushels / maxProduction);
      const alpha = intensity * usdaOpacity;
      const fillColor = `rgba(${r},${g},${b},${alpha})`;

      return polygons.flatMap((rings, idx) => {
        const outerRing = rings[0];
        if (!outerRing) return [];
        return [{
        key: `${county.fips}-${idx}`,
        coordinates: outerRing.map(pt => ({ longitude: pt[0], latitude: pt[1] })),
        holes: rings.slice(1).map((ring) => (
          ring.map(pt => ({ longitude: pt[0], latitude: pt[1] }))
        )),
        fillColor,
        county,
        }];
      });
    });
  }, [productionData, maxProduction, usdaMetadata, usdaCrop, usdaOpacity]);

  const sldBody = useMemo(() => {
    if (!usdaMetadata || !usdaCrop || !usdaYear) return "";
    const cropMeta = usdaMetadata.crops.find(c => c.id === usdaCrop);
    if (!cropMeta) return "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:se="http://www.opengis.net/se">
  <NamedLayer>
    <Name>${usdaMetadata.cdlLayerPrefix}${usdaYear}</Name>
    <UserStyle>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <ColorMap type="values">
              <ColorMapEntry color="#000000" quantity="0" opacity="0"/>
              <ColorMapEntry color="${cropMeta.color}" quantity="${cropMeta.cdlClass}" opacity="1"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`;

    return `&SLD_BODY=${encodeURIComponent(xml.replace(/\s+/g, " "))}`;
  }, [usdaMetadata, usdaCrop, usdaYear]);

  useEffect(() => {
    if (
      filters.county.trim() === ""
      && livePins
      && livePins.every((pin) => pin.lat != null && pin.lng != null)
    ) {
      setLocationPollingActive(false);
    }
  }, [filters.county, livePins]);

  // Offline cache key encodes the COMPLETE query/filter state so a filtered
  // response never overwrites another filter's cached pins.
  const cacheKey = useMemo(
    () => mapPinsCacheKey(filterInput, canProspects),
    [filterInput, canProspects]
  );
  const pins = useOfflineCache<CustomerMapPin[]>(cacheKey, livePins, !isOnline);

  // Client-side audience guard: honour the selected audience and strip prospect
  // pins for unauthorized users even if the server or a stale cache returns them.
  const visiblePins = useMemo(
    () => filterPinsByAudience(pins ?? [], filters.audience, canProspects),
    [pins, filters.audience, canProspects]
  );

  const pinsWithCoords = useMemo(
    () => visiblePins.filter((p) => p.lat != null && p.lng != null),
    [visiblePins]
  );
  const pinsWithoutCoords = visiblePins.length - pinsWithCoords.length;

  const territories = useMemo(() => {
    const set = new Set<string>();
    for (const p of pinsWithCoords) {
      if (p.territory) set.add(p.territory);
    }
    return Array.from(set).sort();
  }, [pinsWithCoords]);

  const initialRegion = useMemo(() => {
    if (pinsWithCoords.length === 0) {
      return { latitude: 39.5, longitude: -98.35, latitudeDelta: 30, longitudeDelta: 30 };
    }
    const lats = pinsWithCoords.map((p) => p.lat!);
    const lngs = pinsWithCoords.map((p) => p.lng!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latDelta = Math.max((maxLat - minLat) * 1.4, 0.05);
    const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.05);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
  }, [pinsWithCoords]);

  useEffect(() => {
    if (!debouncedRegion) setDebouncedRegion(initialRegion);
  }, [debouncedRegion, initialRegion]);

  useEffect(() => {
    if (!mapReady || pinsWithCoords.length === 0) return;
    mapRef.current?.fitToCoordinates(
      pinsWithCoords.map((pin) => ({
        latitude: pin.lat!,
        longitude: pin.lng!,
      })),
      {
        animated: true,
        edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
      },
    );
  }, [mapReady, pinsWithCoords]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const pinColor = (pin: CustomerMapPin): string => {
    if (colorMode === "mine") {
      return pin.repId && currentMember?.id && pin.repId === currentMember.id ? MINE_COLOR : OTHER_COLOR;
    }
    return colorForTerritory(pin.territory, territories);
  };

  const openCustomer = (pinId: number) => {
    router.push({ pathname: "/customer/[id]", params: { id: pinId } });
  };

  const audienceOptions = audienceOptionsForUser(canProspects);
  const shownAudience = effectiveAudience(filters.audience, canProspects);
  const filtersDirty = !isFilterStateDefault(filters);

  const resetFilters = () => setFilters(EMPTY_FILTER_STATE);
  const setFilter = (patch: Partial<CustomerMapFilterState>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const legendItems =
    colorMode === "territory"
      ? [
          ...territories.map((t) => ({ label: t, color: colorForTerritory(t, territories) })),
          ...((pinsWithCoords.some((p) => !p.territory))
            ? [{ label: "No territory", color: UNASSIGNED_COLOR }]
            : []),
        ]
      : [
          { label: "Mine", color: MINE_COLOR },
          { label: "Other", color: OTHER_COLOR },
        ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 16, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Customer Map</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {pinsWithCoords.length} pinned
              {pinsWithoutCoords > 0 ? ` · ${pinsWithoutCoords} unmapped` : ""}
              {" · tap a pin for details"}
            </Text>
          </View>
          <Pressable
            testID="map-layers-toggle"
            accessibilityRole="button"
            accessibilityLabel="Layers"
            onPress={() => {
              setLayersOpen((v) => !v);
              if (!layersOpen) setFiltersOpen(false);
            }}
            style={[styles.refreshBtn, { backgroundColor: layersOpen ? colors.primary : colors.muted }]}
          >
            <Feather name="layers" size={14} color={layersOpen ? "#fff" : colors.primary} />
          </Pressable>
          <Pressable
            testID="map-filters-toggle"
            accessibilityRole="button"
            accessibilityLabel="Filters"
            onPress={() => {
              setFiltersOpen((v) => !v);
              if (!filtersOpen) setLayersOpen(false);
            }}
            style={[styles.refreshBtn, { backgroundColor: filtersDirty ? colors.primary : colors.muted }]}
          >
            <Feather name="sliders" size={14} color={filtersDirty ? "#fff" : colors.primary} />
          </Pressable>
          <Pressable
            testID="map-refresh"
            accessibilityRole="button"
            accessibilityLabel="Refresh map"
            onPress={() => refetch()}
            disabled={isRefetching}
            style={[styles.refreshBtn, { backgroundColor: colors.muted }]}
          >
            <Feather
              name="refresh-cw"
              size={14}
              color={isRefetching ? colors.mutedForeground : colors.primary}
            />
          </Pressable>
        </View>

        <View style={styles.toggleStack}>
          <View style={[styles.toggleRow, { backgroundColor: colors.muted }]}>
            <Pressable
              testID="map-all"
              style={[styles.toggleBtn, !mineOnly && { backgroundColor: colors.card }]}
              onPress={() => setMineOnly(false)}
            >
              <Feather name="users" size={13} color={!mineOnly ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleBtnText, { color: !mineOnly ? colors.primary : colors.mutedForeground }]}>
                All
              </Text>
            </Pressable>
            <Pressable
              testID="map-mine"
              style={[styles.toggleBtn, mineOnly && { backgroundColor: colors.card }]}
              onPress={() => setMineOnly(true)}
              disabled={!currentMember?.id}
            >
              <Feather name="user" size={13} color={mineOnly ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleBtnText, { color: mineOnly ? colors.primary : colors.mutedForeground }]}>
                Mine
              </Text>
            </Pressable>
          </View>

          <View style={[styles.toggleRow, { backgroundColor: colors.muted }]}>
            <Pressable
              testID="map-territory"
              style={[styles.toggleBtn, colorMode === "territory" && { backgroundColor: colors.card }]}
              onPress={() => setColorMode("territory")}
            >
              <Feather name="grid" size={13} color={colorMode === "territory" ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleBtnText, { color: colorMode === "territory" ? colors.primary : colors.mutedForeground }]}>
                Territory
              </Text>
            </Pressable>
            <Pressable
              testID="map-claimed"
              style={[styles.toggleBtn, colorMode === "mine" && { backgroundColor: colors.card }]}
              onPress={() => setColorMode("mine")}
            >
              <Feather name="check-circle" size={13} color={colorMode === "mine" ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.toggleBtnText, { color: colorMode === "mine" ? colors.primary : colors.mutedForeground }]}>
                Claimed
              </Text>
            </Pressable>
          </View>
        </View>

        {layersOpen && (
          <View style={[styles.filterPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Base Layer</Text>
            <View style={[styles.toggleRow, { backgroundColor: colors.muted, alignSelf: "flex-start", flexWrap: "wrap" }]}>
              {BASE_LAYER_ORDER.map((layer) => {
                const active = baseLayer === layer;
                return (
                  <Pressable
                    key={layer}
                    style={[styles.toggleBtn, active && { backgroundColor: colors.card }]}
                    onPress={() => setBaseLayer(layer)}
                  >
                    <Text style={[styles.toggleBtnText, { color: active ? colors.primary : colors.mutedForeground }]}>
                      {BASE_LAYERS[layer].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.filterLabel, { color: colors.mutedForeground, marginTop: 4 }]}>USDA Layers</Text>
            <View style={[styles.toggleRow, { backgroundColor: colors.muted, alignSelf: "flex-start", flexWrap: "wrap" }]}>
              {[
                { id: "none", label: "None" },
                { id: "production", label: "County Production" },
                { id: "coverage", label: "Crop Coverage" }
              ].map((opt) => {
                const active = usdaLayer === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    style={[styles.toggleBtn, active && { backgroundColor: colors.card }]}
                    onPress={() => setUsdaLayer(opt.id as any)}
                  >
                    <Text style={[styles.toggleBtnText, { color: active ? colors.primary : colors.mutedForeground }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {usdaLayer !== "none" && usdaMetadata && (
              <>
                <View style={styles.filterFieldRow}>
                  <View style={styles.filterField}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground, marginTop: 4 }]}>Crop</Text>
                    <View style={[styles.toggleRow, { backgroundColor: colors.muted, alignSelf: "flex-start" }]}>
                      {usdaMetadata.crops.map((c) => {
                        const active = usdaCrop === c.id;
                        return (
                          <Pressable
                            key={c.id}
                            style={[styles.toggleBtn, active && { backgroundColor: colors.card }]}
                            onPress={() => setUsdaCrop(c.id as any)}
                          >
                            <Text style={[styles.toggleBtnText, { color: active ? colors.primary : colors.mutedForeground }]}>
                              {c.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.filterField}>
                    <Text style={[styles.filterLabel, { color: colors.mutedForeground, marginTop: 4 }]}>Year</Text>
                    <View style={[styles.toggleRow, { backgroundColor: colors.muted, alignSelf: "flex-start" }]}>
                      {(usdaLayer === "production" ? usdaMetadata.productionYears : usdaMetadata.coverageYears)
                        .slice(0, 4)
                        .map((y) => {
                          const active = usdaYear === y;
                          return (
                            <Pressable
                              key={y}
                              style={[styles.toggleBtn, active && { backgroundColor: colors.card }]}
                              onPress={() => setUsdaYear(y)}
                            >
                              <Text style={[styles.toggleBtnText, { color: active ? colors.primary : colors.mutedForeground }]}>
                                {y}
                              </Text>
                            </Pressable>
                          );
                        })}
                    </View>
                  </View>
                </View>

                <Text style={[styles.filterLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
                  Opacity: {Math.round(usdaOpacity * 100)}%
                </Text>
                <View style={[styles.toggleRow, { backgroundColor: colors.muted, alignSelf: "flex-start" }]}>
                  {[0.25, 0.5, 0.75, 1.0].map((val) => (
                    <Pressable
                      key={val}
                      style={[styles.toggleBtn, usdaOpacity === val && { backgroundColor: colors.card }]}
                      onPress={() => setUsdaOpacity(val)}
                    >
                      <Text style={[styles.toggleBtnText, { color: usdaOpacity === val ? colors.primary : colors.mutedForeground }]}>
                        {val * 100}%
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {filtersOpen && (
          <View style={[styles.filterPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Audience */}
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Show</Text>
            <View style={[styles.toggleRow, { backgroundColor: colors.muted, alignSelf: "flex-start" }]}>
              {audienceOptions.map((opt) => {
                const active = filters.audience === opt;
                return (
                  <Pressable
                    key={opt}
                    testID={`map-audience-${opt}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.toggleBtn, active && { backgroundColor: colors.card }]}
                    onPress={() => setFilter({ audience: opt })}
                  >
                    <Text style={[styles.toggleBtnText, { color: active ? colors.primary : colors.mutedForeground }]}>
                      {AUDIENCE_LABELS[opt]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* County / ZIP */}
            <View style={styles.filterFieldRow}>
              <View style={styles.filterField}>
                <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>County</Text>
                <TextInput
                  testID="map-filter-county"
                  value={filters.county}
                  onChangeText={(t) => setFilter({ county: t })}
                  placeholder="Any county"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
              <View style={styles.filterField}>
                <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>ZIP</Text>
                <TextInput
                  testID="map-filter-zip"
                  value={filters.zip}
                  onChangeText={(t) => setFilter({ zip: t })}
                  placeholder="Any ZIP"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
            </View>
            {/* Acreage min / max */}
            <View style={styles.filterFieldRow}>
              <View style={styles.filterField}>
                <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Min acres</Text>
                <TextInput
                  testID="map-filter-min-acres"
                  value={filters.minAcres}
                  onChangeText={(t) => setFilter({ minAcres: t })}
                  placeholder="0"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
              <View style={styles.filterField}>
                <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Max acres</Text>
                <TextInput
                  testID="map-filter-max-acres"
                  value={filters.maxAcres}
                  onChangeText={(t) => setFilter({ maxAcres: t })}
                  placeholder="Any"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
            </View>
            {acreageFilterError ? (
              <Text
                testID="map-acreage-filter-error"
                accessibilityRole="alert"
                style={[styles.filterError, { color: colors.destructive }]}
              >
                {acreageFilterError}
              </Text>
            ) : null}

            {/* Size markers by acreage */}
            <View style={styles.switchRow}>
              <Text
                style={[styles.filterLabel, { color: colors.foreground, marginBottom: 0, flex: 1 }]}
                nativeID="size-by-acreage-label"
              >
                Size markers by acreage
              </Text>
              <Switch
                testID="map-size-by-acreage"
                accessibilityLabel="Size markers by acreage"
                accessibilityRole="switch"
                accessibilityState={{ checked: sizeByAcreage }}
                aria-labelledby="size-by-acreage-label"
                value={sizeByAcreage}
                onValueChange={setSizeByAcreage}
                trackColor={{ true: colors.primary, false: colors.muted }}
              />
            </View>

            <Pressable
              testID="map-filter-reset"
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              onPress={resetFilters}
              disabled={!filtersDirty}
              style={[styles.resetBtn, { borderColor: colors.border, opacity: filtersDirty ? 1 : 0.5 }]}
            >
              <Feather name="rotate-ccw" size={13} color={colors.primary} />
              <Text style={[styles.resetBtnText, { color: colors.primary }]}>Reset filters</Text>
            </Pressable>
          </View>
        )}
      </View>

      {isLoading && !pins ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : pinsWithCoords.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="map-pin"
            title="No pinned locations"
            subtitle={
              filtersDirty || shownAudience !== "both"
                ? "No locations match the current filters. Try widening or resetting them."
                : mineOnly
                ? "None of your customers have a saved location yet."
                : "Locations will appear here once they have coordinates."
            }
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            provider={Platform.OS === "android" ? PROVIDER_DEFAULT : undefined}
            mapType="none"
            initialRegion={initialRegion}
            onMapReady={() => setMapReady(true)}
            onRegionChangeComplete={handleRegionChangeComplete}
          >
            <UrlTile
              urlTemplate={BASE_LAYERS[baseLayer].tileUrl("{z}", "{x}", "{y}")}
              maximumZ={19}
              zIndex={-2}
            />
            {BASE_LAYERS[baseLayer].overlayUrl && (
              <UrlTile
                urlTemplate={BASE_LAYERS[baseLayer].overlayUrl("{z}", "{x}", "{y}")}
                maximumZ={19}
                zIndex={-1}
              />
            )}

            {usdaLayer === "production" && productionPolygons.map((poly) => (
              <Polygon
                key={poly.key}
                coordinates={poly.coordinates}
                holes={poly.holes}
                fillColor={poly.fillColor}
                strokeColor={colors.border}
                strokeWidth={1}
                zIndex={0}
                tappable
                onPress={(e) => {
                  if (e.nativeEvent.coordinate) {
                    setSelectedCounty({
                      name: `${poly.county.name}, ${poly.county.state}`,
                      bushels: poly.county.productionBushels,
                      coordinate: e.nativeEvent.coordinate
                    });
                  }
                }}
              />
            ))}

            {usdaLayer === "coverage" && usdaMetadata && usdaYear && (
              <WMSTile
                urlTemplate={`${usdaMetadata.cdlWmsBaseUrl}?service=WMS&request=GetMap&layers=${usdaMetadata.cdlLayerPrefix}${usdaYear}&styles=&format=image/png&transparent=true&version=1.1.1&width=256&height=256&srs=EPSG:3857&bbox={minX},{minY},{maxX},{maxY}${sldBody}`}
                zIndex={0}
                opacity={usdaOpacity}
                tileSize={256}
              />
            )}

            {selectedCounty && usdaLayer === "production" && (
              <Marker coordinate={selectedCounty.coordinate} tracksViewChanges={false}>
                <View style={{ width: 1, height: 1 }} />
                <Callout tooltip>
                  <View style={[styles.callout, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.calloutName, { color: colors.foreground }]}>{selectedCounty.name}</Text>
                    <Text style={[styles.calloutMeta, { color: colors.mutedForeground }]}>
                      {selectedCounty.bushels.toLocaleString()} bushels
                    </Text>
                  </View>
                </Callout>
              </Marker>
            )}

            {pinsWithCoords.map((pin) => {
              const color = pinColor(pin);
              const kind = pin.kind === "prospect" ? "prospect" : "customer";
              const glyph = markerGlyphSize(sizeByAcreage, pin.totalAcres, kind);
              const isProspect = kind === "prospect";
              const county = pin.county;
              return (
                <Marker
                  // Include the visual key so the marker view remounts whenever
                  // its rendered size/shape changes (toggle or filter change),
                  // preventing tracksViewChanges={false} from keeping a stale
                  // snapshot.
                  key={`${pin.kind}-${pin.id}-${markerVisualKey(sizeByAcreage, pin.totalAcres, kind)}`}
                  coordinate={{ latitude: pin.lat!, longitude: pin.lng! }}
                  tracksViewChanges={false}
                >
                  {/* Fixed-size box keeps native anchoring stable while the
                      customer circle or prospect star scales inside it. */}
                  <View style={styles.markerBox} pointerEvents="none">
                    {isProspect ? (
                      <View style={[styles.markerStar, { width: glyph, height: glyph }]}>
                        <FontAwesome name="star" size={glyph} color="#fff" />
                        <FontAwesome
                          name="star"
                          size={Math.max(10, glyph - 4)}
                          color={color}
                          style={styles.markerStarFill}
                        />
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.markerCircle,
                          {
                            width: glyph,
                            height: glyph,
                            borderRadius: glyph / 2,
                            backgroundColor: color,
                            borderColor: "#fff",
                          },
                        ]}
                      />
                    )}
                  </View>
                  <Callout tooltip onPress={() => !isProspect && openCustomer(pin.id)}>
                    <View style={[styles.callout, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.calloutTitleRow}>
                        {isProspect ? (
                          <FontAwesome name="star" size={11} color={color} />
                        ) : (
                          <View style={[styles.legendDot, { backgroundColor: color }]} />
                        )}
                        <Text style={[styles.calloutName, { color: colors.foreground }]} numberOfLines={1}>
                          {pin.name}
                        </Text>
                      </View>
                      <Text style={[styles.calloutKind, { color: colors.mutedForeground }]}>
                        {isProspect ? "Prospect" : "Customer"}
                      </Text>
                      {(pin.city || pin.state) && (
                        <Text style={[styles.calloutMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {[pin.city, pin.state].filter(Boolean).join(", ")}
                          {pin.zip ? ` ${pin.zip}` : ""}
                        </Text>
                      )}
                      {county && (
                        <Text style={[styles.calloutMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          County: {county}
                        </Text>
                      )}
                      {pin.totalAcres != null && (
                        <Text style={[styles.calloutMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {Math.round(pin.totalAcres).toLocaleString()} acres
                        </Text>
                      )}
                      {pin.territory && (
                        <Text style={[styles.calloutMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          Territory: {pin.territory}
                        </Text>
                      )}
                      {!isProspect && (
                        <Text style={[styles.calloutHint, { color: colors.primary }]}>Tap to open →</Text>
                      )}
                    </View>
                  </Callout>
                </Marker>
              );
            })}
          </MapView>

          {usdaLayer !== "none" && (
            <View
              pointerEvents="none"
              style={[
                styles.usdaLegend,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.usdaLegendTitleRow}>
                {selectedUsdaCrop && (
                  <View
                    style={[
                      styles.usdaCropSwatch,
                      { backgroundColor: selectedUsdaCrop.color },
                    ]}
                  />
                )}
                <Text style={[styles.usdaLegendTitle, { color: colors.foreground }]}>
                  {selectedUsdaCrop?.label ?? "USDA"} · {usdaYear ?? "—"}
                </Text>
                {(isUsdaMetadataLoading || isProductionFetching) && (
                  <ActivityIndicator size="small" color={colors.primary} />
                )}
              </View>
              {usdaLayerError ? (
                <Text style={[styles.usdaLegendMessage, { color: colors.destructive }]}>
                  {usdaLayerError}
                </Text>
              ) : usdaLayer === "production" ? (
                <>
                  <View style={styles.usdaScaleRow}>
                    {[0.2, 0.4, 0.65, 1].map((alpha) => (
                      <View
                        key={alpha}
                        style={[
                          styles.usdaScaleBlock,
                          {
                            backgroundColor: selectedUsdaCrop
                              ? `${selectedUsdaCrop.color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`
                              : colors.primary,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <View style={styles.usdaScaleLabels}>
                    <Text style={[styles.usdaLegendMessage, { color: colors.mutedForeground }]}>Lower</Text>
                    <Text style={[styles.usdaLegendMessage, { color: colors.mutedForeground }]}>Higher bushels</Text>
                  </View>
                  {!isProductionFetching && productionData?.counties.length === 0 && (
                    <Text style={[styles.usdaLegendMessage, { color: colors.mutedForeground }]}>
                      No published county totals in this view.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={[styles.usdaLegendMessage, { color: colors.mutedForeground }]}>
                  Annual crop-location coverage
                </Text>
              )}
              <Text style={[styles.usdaAttribution, { color: colors.mutedForeground }]}>
                {BASE_LAYERS[baseLayer].attribution}
                {usdaMetadata
                  ? ` · ${usdaLayer === "production" ? usdaMetadata.productionAttribution : usdaMetadata.cdlAttribution}`
                  : ""}
              </Text>
            </View>
          )}

          {legendItems.length > 0 && (
            <View
              pointerEvents="none"
              style={[
                styles.legend,
                { backgroundColor: colors.card, borderColor: colors.border, top: 4 },
              ]}
            >
              {legendItems.slice(0, 6).map((item) => (
                <View key={item.label} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.legendText, { color: colors.foreground }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                </View>
              ))}
              {legendItems.length > 6 && (
                <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
                  +{legendItems.length - 6} more
                </Text>
              )}
              {canProspects && (
                <View style={[styles.legendRow, { marginTop: 2 }]}>
                  <FontAwesome name="star" size={11} color={colors.mutedForeground} />
                  <Text style={[styles.legendText, { color: colors.foreground }]} numberOfLines={1}>
                    Prospect
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
      <QuickLogFab bottomOffset={insets.bottom + 56} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  refreshBtn: { width: 32, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  toggleStack: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  toggleRow: { flexDirection: "row", borderRadius: 8, padding: 3, gap: 2 },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toggleBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  filterPanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  filterLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  filterFieldRow: { flexDirection: "row", gap: 10 },
  filterError: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  filterField: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
  },
  resetBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  markerBox: {
    width: MARKER_BOX,
    height: MARKER_BOX,
    justifyContent: "center",
    alignItems: "center",
  },
  markerCircle: {
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  markerStar: {
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  markerStarFill: { position: "absolute" },
  callout: {
    minWidth: 160,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  calloutTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  calloutName: { fontSize: 13, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  calloutKind: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 },
  calloutMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  calloutHint: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  legend: {
    position: "absolute",
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    maxWidth: 160,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  usdaLegend: {
    position: "absolute",
    left: 8,
    bottom: 12,
    maxWidth: 250,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  usdaLegendTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  usdaLegendTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  usdaLegendMessage: { fontSize: 10, fontFamily: "Inter_400Regular" },
  usdaCropSwatch: { width: 11, height: 11, borderRadius: 2 },
  usdaScaleRow: { flexDirection: "row", height: 7, borderRadius: 3, overflow: "hidden" },
  usdaScaleBlock: { flex: 1 },
  usdaScaleLabels: { flexDirection: "row", justifyContent: "space-between" },
  usdaAttribution: { fontSize: 8, fontFamily: "Inter_400Regular", marginTop: 2 },
});

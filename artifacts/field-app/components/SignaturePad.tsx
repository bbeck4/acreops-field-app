import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GestureResponderEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

export type SignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  toSvg: () => string | null;
};

type Props = {
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  backgroundColor?: string;
  borderColor?: string;
  mutedColor?: string;
  onChange?: (isEmpty: boolean) => void;
};

type Point = { x: number; y: number };

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} l 0.1 0`;
  }
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  {
    width,
    height = 200,
    strokeColor = "#0f172a",
    strokeWidth = 2.5,
    backgroundColor = "#ffffff",
    borderColor = "#e5e7eb",
    mutedColor = "#94a3b8",
    onChange,
  },
  ref,
) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const currentStroke = useRef<Point[]>([]);
  const containerRef = useRef<View>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: width ?? 0, height });

  const handleStart = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    currentStroke.current = [{ x: locationX, y: locationY }];
    setStrokes((prev) => [...prev, currentStroke.current]);
  }, []);

  const handleMove = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const last = currentStroke.current[currentStroke.current.length - 1];
    if (!last || Math.hypot(last.x - locationX, last.y - locationY) > 1) {
      currentStroke.current.push({ x: locationX, y: locationY });
      setStrokes((prev) => {
        const next = prev.slice();
        next[next.length - 1] = currentStroke.current.slice();
        return next;
      });
    }
  }, []);

  const handleEnd = useCallback(() => {
    onChange?.(false);
    currentStroke.current = [];
  }, [onChange]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: handleStart,
        onPanResponderMove: handleMove,
        onPanResponderRelease: handleEnd,
        onPanResponderTerminate: handleEnd,
      }),
    [handleStart, handleMove, handleEnd],
  );

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        currentStroke.current = [];
        setStrokes([]);
        onChange?.(true);
      },
      isEmpty: () => strokes.length === 0,
      toSvg: () => {
        if (strokes.length === 0) return null;
        const w = Math.max(1, Math.round(sizeRef.current.width));
        const h = Math.max(1, Math.round(sizeRef.current.height));
        const paths = strokes
          .map(
            (s) =>
              `<path d="${pointsToPath(s)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
          )
          .join("");
        return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${backgroundColor}"/>${paths}</svg>`;
      },
    }),
    [strokes, strokeColor, strokeWidth, backgroundColor, onChange],
  );

  const isEmpty = strokes.length === 0;

  return (
    <View
      ref={containerRef}
      onLayout={(e) => {
        sizeRef.current = {
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        };
      }}
      style={[
        styles.container,
        { height, backgroundColor, borderColor, width: width ?? "100%" },
      ]}
      {...panResponder.panHandlers}
    >
      <Svg width="100%" height="100%">
        {strokes.map((s, i) => (
          <Path
            key={i}
            d={pointsToPath(s)}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
      {isEmpty && (
        <View pointerEvents="none" style={styles.placeholderWrap}>
          <Text style={[styles.placeholder, { color: mutedColor }]}>Sign here</Text>
        </View>
      )}
      <View pointerEvents="none" style={[styles.baseline, { backgroundColor: borderColor }]} />
    </View>
  );
});

export function SignaturePadActions({
  onClear,
  color,
  disabled,
}: {
  onClear: () => void;
  color: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onClear}
      disabled={disabled}
      style={({ pressed }) => [styles.clearBtn, { opacity: pressed || disabled ? 0.5 : 1 }]}
      testID="button-clear-signature"
    >
      <Text style={[styles.clearText, { color }]}>Clear</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  placeholderWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  baseline: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 28,
    height: 1,
    opacity: 0.6,
  },
  clearBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  clearText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});

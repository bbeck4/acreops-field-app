import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === "dark" && "dark" in colors
    ? (colors as unknown as Record<string, typeof colors.light>).dark
    : colors.light;
  return { ...palette, radius: colors.radius };
}

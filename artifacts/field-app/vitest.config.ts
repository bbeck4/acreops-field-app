import { defineConfig } from "vitest/config";
import path from "path";

// Standalone Vitest config for the field-app's pure helper modules. We do not
// load the Expo/Metro toolchain here — these tests cover plain TS logic
// (sampling next-point + point-in-polygon), so a Node environment is enough.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
  },
});

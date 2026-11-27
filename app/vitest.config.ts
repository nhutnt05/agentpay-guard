import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for lib/ and route logic (docs/10 §5). Node environment: server-side code
// and pure helpers; no DOM tests in the MVP.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

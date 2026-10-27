import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["poetics-source"],
  },
  ssr: {
    resolve: {
      conditions: ["poetics-source"],
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts", "site/src/**/*.test.ts"],
    environment: "node",
  },
});

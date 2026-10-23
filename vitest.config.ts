import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/delivery/**/*.test.ts", "tests/engine/**/*.test.ts"],
  },
});

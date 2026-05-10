import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"],
    exclude: ["cdk.out/**", "node_modules/**"],
    // CDK synth runs esbuild on the Lambda bundle (~600–1500ms on CI ubuntu).
    // Tests that build a stack — and hooks that build it once for the suite —
    // need more headroom than Vitest's 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

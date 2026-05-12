import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"],
    exclude: ["cdk.out/**", "node_modules/**"],
    // CDK synth runs esbuild on every Lambda bundle. With the addition of the
    // annotate-stream Lambda (which inlines ~6 MB of frequency-dictionary
    // JSONs), each stack synth on CI ubuntu now takes ~10–20 s. `stack.dev.test`
    // synthesizes both dev and prod stacks in its beforeAll, so the hook budget
    // needs to fit two synths back-to-back with headroom.
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});

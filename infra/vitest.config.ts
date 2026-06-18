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
    //
    // These synth-heavy files are CPU-bound. Running them in parallel makes the
    // two heaviest (stack.dev = dev+prod synths, stack.snapshot = prod synth)
    // contend for the runner's cores — under the deploy gate's combined
    // `turbo lint typecheck test` load on a 2-core CI box, that starved
    // stack.dev's beforeAll past the hook timeout. Run this package's files
    // sequentially so each synth gets the CPU, and keep a wide hook budget for
    // two back-to-back synths under any residual cross-package load.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});

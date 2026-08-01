import { build } from "esbuild";

const sharedOptions = {
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: true,
  logLevel: "info"
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ["desktop/main.ts"],
    external: ["electron"],
    define: { "import.meta.url": JSON.stringify("file:///relay/pglite-runtime.js") },
    format: "cjs",
    outfile: "dist-desktop/main.cjs"
  }),
  build({
    ...sharedOptions,
    entryPoints: ["desktop/preload.ts"],
    external: ["electron"],
    format: "cjs",
    outfile: "dist-desktop/preload.cjs"
  }),
  build({
    ...sharedOptions,
    entryPoints: ["src/local/worker.ts"],
    format: "cjs",
    outfile: "dist-desktop/worker.cjs"
  })
]);

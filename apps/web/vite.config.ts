import { readFileSync } from "node:fs";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CI sets HEOROT_DESKTOP_VERSION from the release tag. Outside CI - a docker
// build of the web app, or a local run - fall back to the package version.
const appVersion =
    process.env.HEOROT_DESKTOP_VERSION ||
    (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string) ||
    "dev";

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        // Distinguishes two deploys of the same version, which is exactly the
        // ambiguity that cost us time chasing a stale bundle.
        __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [react()],
    optimizeDeps: {
        // Keep this package unbundled in dev so its internal WASM URL resolves to a real .wasm file.
        exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
    },
    worker: {
        // The matrix-js-sdk IndexedDB worker pulls in a graph that has to be
        // code-split, which Vite's default "iife" worker format cannot do.
        format: "es",
    },
});

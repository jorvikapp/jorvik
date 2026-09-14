import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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

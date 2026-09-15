import { defineConfig } from "vitest/config";

export default defineConfig({
    // vite.config.ts injects these; tests need them too or anything importing
    // the version module blows up on an undefined global.
    define: {
        __APP_VERSION__: JSON.stringify("test"),
        __APP_BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
    },
    test: {
        globals: false,
        environment: "jsdom",
        setupFiles: ["./test/setup.ts"],
        include: ["test/unit-tests/**/*.test.ts", "test/unit-tests/**/*.test.tsx"],
        clearMocks: true,
        restoreMocks: true,
        mockReset: true,
    },
});

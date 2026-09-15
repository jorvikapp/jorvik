import { afterEach, describe, expect, it, vi } from "vitest";

import { getBuildVersionInfo, resolveAppVersionInfo } from "../../../../src/ui/version/appVersion";

afterEach(() => {
    delete (window as { heorotDesktop?: unknown }).heorotDesktop;
});

describe("app version", () => {
    it("reports the web surface when there is no desktop bridge", () => {
        const info = getBuildVersionInfo();
        expect(info.surface).toBe("web");
        expect(info.version).toBe("test");
        expect(info.label).toContain("(web)");
    });

    it("prefers the packaged version over the build constant on desktop", async () => {
        (window as { heorotDesktop?: unknown }).heorotDesktop = {
            getAppVersion: vi.fn(async () => "1.0.3"),
        };

        const info = await resolveAppVersionInfo();
        expect(info.version).toBe("1.0.3");
        expect(info.surface).toBe("desktop");
        expect(info.label).toContain("1.0.3 (desktop)");
    });

    it("falls back to the build constant when the bridge has no handler", async () => {
        (window as { heorotDesktop?: unknown }).heorotDesktop = {};
        const info = await resolveAppVersionInfo();
        expect(info.version).toBe("test");
        expect(info.surface).toBe("desktop");
    });

    it("falls back when the bridge throws", async () => {
        (window as { heorotDesktop?: unknown }).heorotDesktop = {
            getAppVersion: vi.fn(async () => {
                throw new Error("no handler");
            }),
        };
        const info = await resolveAppVersionInfo();
        expect(info.version).toBe("test");
    });
});

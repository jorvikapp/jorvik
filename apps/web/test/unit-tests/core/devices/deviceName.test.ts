// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { describeDevice, hasDefaultName, nameThisDevice } from "../../../../src/core/devices/deviceName";

const UA = {
    chromeWindows:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    edgeWindows:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    operaWindows:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0",
    firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
    safariMac:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    safariIphone:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    chromeIphone:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
    firefoxIphone:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15",
    chromeAndroid:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    samsungAndroid:
        "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
    chromeOs:
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    electronLinux:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Jorvik/1.0.28 Chrome/142.0.0.0 Electron/44.7.0 Safari/537.36",
};

function web(userAgent: string, maxTouchPoints = 0): string {
    return describeDevice({ userAgent, standalone: false, maxTouchPoints });
}

describe("session names", () => {
    it("name the browser and the system for the web app", () => {
        expect(web(UA.chromeWindows)).toBe("Jorvik Web (Chrome on Windows)");
        expect(web(UA.edgeWindows)).toBe("Jorvik Web (Edge on Windows)");
        expect(web(UA.operaWindows)).toBe("Jorvik Web (Opera on Windows)");
        expect(web(UA.firefoxLinux)).toBe("Jorvik Web (Firefox on Linux)");
        expect(web(UA.safariMac)).toBe("Jorvik Web (Safari on macOS)");
        expect(web(UA.safariIphone)).toBe("Jorvik Web (Safari on iOS)");
        expect(web(UA.chromeIphone)).toBe("Jorvik Web (Chrome on iOS)");
        expect(web(UA.firefoxIphone)).toBe("Jorvik Web (Firefox on iOS)");
        expect(web(UA.chromeAndroid)).toBe("Jorvik Web (Chrome on Android)");
        expect(web(UA.samsungAndroid)).toBe("Jorvik Web (Samsung Internet on Android)");
        expect(web(UA.chromeOs)).toBe("Jorvik Web (Chrome on ChromeOS)");
    });

    it("know an iPad asking for the desktop site by its touch screen", () => {
        expect(web(UA.safariMac, 5)).toBe("Jorvik Web (Safari on iOS)");
    });

    it("say what they can when the browser or system is unknown", () => {
        expect(web("curl/8.5.0")).toBe("Jorvik Web");
        expect(web("Mozilla/5.0 (X11; Linux x86_64) SomeBrowser/1.0")).toBe("Jorvik Web (Linux)");
    });

    it("name the desktop app by its system only, whatever its user agent says", () => {
        const desktop = (desktopPlatform: string): string =>
            describeDevice({ userAgent: UA.electronLinux, desktopPlatform, standalone: false, maxTouchPoints: 0 });
        expect(desktop("linux")).toBe("Jorvik Desktop (Linux)");
        expect(desktop("win32")).toBe("Jorvik Desktop (Windows)");
        expect(desktop("darwin")).toBe("Jorvik Desktop (macOS)");
        expect(desktop("freebsd")).toBe("Jorvik Desktop");
    });

    it("name the web app added to a home screen as an app", () => {
        expect(describeDevice({ userAgent: UA.safariIphone, standalone: true, maxTouchPoints: 5 })).toBe("Jorvik App (iOS)");
        expect(describeDevice({ userAgent: UA.chromeAndroid, standalone: true, maxTouchPoints: 5 })).toBe("Jorvik App (Android)");
    });

    it("never carry the phone model or anything else from the user agent", () => {
        expect(web(UA.samsungAndroid)).not.toContain("SM-S918B");
    });

    it("count no name and the old one as Jorvik's own, and leave anything else alone", () => {
        expect(hasDefaultName(undefined)).toBe(true);
        expect(hasDefaultName(" ")).toBe(true);
        expect(hasDefaultName("Jorvik Web")).toBe(true);
        expect(hasDefaultName("Jorvik Web (Firefox on Linux)")).toBe(false);
        expect(hasDefaultName("My laptop")).toBe(false);
    });
});

describe("naming this session", () => {
    function fakeClient(displayName: string | undefined) {
        return {
            getDeviceId: () => "DEV",
            getDevice: vi.fn(async () => ({ device_id: "DEV", display_name: displayName })),
            setDeviceDetails: vi.fn(async () => ({})),
        };
    }

    it("names a session that has no name or the old one", async () => {
        for (const old of [undefined, "", "Jorvik Web"]) {
            const client = fakeClient(old);
            expect(await nameThisDevice(client as never, "Jorvik Desktop (Linux)")).toBe(true);
            expect(client.setDeviceDetails).toHaveBeenCalledWith("DEV", { display_name: "Jorvik Desktop (Linux)" });
        }
    });

    it("never renames a session its owner named", async () => {
        const client = fakeClient("Work laptop");
        expect(await nameThisDevice(client as never, "Jorvik Desktop (Linux)")).toBe(false);
        expect(client.setDeviceDetails).not.toHaveBeenCalled();
    });

    it("doesn't rename a session to the name it already has, and survives a failed request", async () => {
        const same = fakeClient("Jorvik Web");
        expect(await nameThisDevice(same as never, "Jorvik Web")).toBe(false);
        expect(same.setDeviceDetails).not.toHaveBeenCalled();

        const failing = fakeClient(undefined);
        failing.setDeviceDetails.mockRejectedValueOnce(new Error("M_LIMIT_EXCEEDED"));
        expect(await nameThisDevice(failing as never, "Jorvik Web (Chrome on Windows)")).toBe(false);
    });
});

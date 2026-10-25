import { logger } from "matrix-js-sdk/src/logger";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * Names for the user's sessions, so they can tell them apart in Settings, Devices and in other apps:
 * "Jorvik Desktop (Linux)", "Jorvik Web (Firefox on Windows)", "Jorvik App (iOS)" for the web app added
 * to a home screen. Other people can see a session's name too (it comes with its encryption keys), so it
 * only ever says which app, browser and system: never a computer's name, a user name or an address.
 */

export interface DeviceEnvironment {
    userAgent: string;
    /** process.platform from the desktop app's bridge ("linux", "win32", "darwin"); absent in a browser. */
    desktopPlatform?: string;
    /** Started from a home screen or app list, as an installed web app. */
    standalone: boolean;
    maxTouchPoints: number;
}

/** What sessions were called before they had names of their own, and are renamed. */
const OLD_DEFAULT_NAMES = new Set(["Jorvik Web"]);

const DESKTOP_SYSTEMS: Record<string, string> = { linux: "Linux", win32: "Windows", darwin: "macOS" };

/** Checked in order: Edge, Opera and Samsung Internet also say Chrome, and nearly everything says Safari. */
const BROWSERS: Array<[RegExp, string]> = [
    [/SamsungBrowser\//, "Samsung Internet"],
    [/Edg(?:A|iOS)?\//, "Edge"],
    [/OPR\/|OPiOS\//, "Opera"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Version\/[\d.]+.*Safari\//, "Safari"],
];

function browserName(userAgent: string): string | null {
    return BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

function systemName(userAgent: string, maxTouchPoints: number): string | null {
    // iPads ask for the desktop site, so they say Macintosh but have a touch screen.
    if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
        return "iOS";
    }
    if (/Android/.test(userAgent)) {
        return "Android";
    }
    if (/CrOS/.test(userAgent)) {
        return "ChromeOS";
    }
    if (/Windows/.test(userAgent)) {
        return "Windows";
    }
    if (/Macintosh|Mac OS X/.test(userAgent)) {
        return "macOS";
    }
    if (/Linux|X11/.test(userAgent)) {
        return "Linux";
    }
    return null;
}

export function describeDevice(env: DeviceEnvironment): string {
    if (env.desktopPlatform !== undefined) {
        const system = DESKTOP_SYSTEMS[env.desktopPlatform];
        return system ? `Jorvik Desktop (${system})` : "Jorvik Desktop";
    }
    const system = systemName(env.userAgent, env.maxTouchPoints);
    if (env.standalone) {
        return system ? `Jorvik App (${system})` : "Jorvik App";
    }
    const browser = browserName(env.userAgent);
    const details = [browser, system].filter(Boolean).join(" on ");
    return details ? `Jorvik Web (${details})` : "Jorvik Web";
}

export function currentDeviceEnvironment(): DeviceEnvironment {
    if (typeof window === "undefined") {
        return { userAgent: "", standalone: false, maxTouchPoints: 0 };
    }
    const standalone =
        (navigator as Navigator & { standalone?: boolean }).standalone === true ||
        window.matchMedia?.("(display-mode: standalone)").matches === true;
    return {
        userAgent: navigator.userAgent,
        desktopPlatform: window.heorotDesktop?.platform,
        standalone,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
    };
}

/** The name for a new session on this computer or phone. */
export function deviceDisplayName(): string {
    return describeDevice(currentDeviceEnvironment());
}

/** Whether a session's name is one Jorvik gave it (or none), as opposed to one its owner chose. */
export function hasDefaultName(displayName: string | null | undefined): boolean {
    const name = displayName?.trim() ?? "";
    return name === "" || OLD_DEFAULT_NAMES.has(name);
}

/**
 * Gives this session its name if it has none yet, or still has the one every Jorvik session used to
 * get. A name its owner chose is left alone.
 */
export async function nameThisDevice(client: MatrixClient, name = deviceDisplayName()): Promise<boolean> {
    try {
        const deviceId = client.getDeviceId();
        if (!deviceId) {
            return false;
        }
        const device = await client.getDevice(deviceId);
        if (!hasDefaultName(device.display_name) || device.display_name === name) {
            return false;
        }
        await client.setDeviceDetails(deviceId, { display_name: name });
        return true;
    } catch (error) {
        logger.warn("[Jorvik devices] could not name this session", error);
        return false;
    }
}

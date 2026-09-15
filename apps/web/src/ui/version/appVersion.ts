/**
 * Build identity, so a bug report can name the exact build it came from.
 *
 * Declared by Vite's define. The desktop app reports its packaged version
 * instead, since that is the installer the user actually has - the bundled web
 * build could have been produced separately.
 */
declare const __APP_VERSION__: string;
declare const __APP_BUILD_TIME__: string;

export interface AppVersionInfo {
    version: string;
    surface: "desktop" | "web";
    buildTime: string;
    /** Single line, for display and for pasting into a bug report. */
    label: string;
}

function formatBuildTime(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return iso;
    }

    return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function toLabel(version: string, surface: "desktop" | "web", buildTime: string): string {
    return `${version} (${surface}) - built ${formatBuildTime(buildTime)}`;
}

export function getBuildVersionInfo(): AppVersionInfo {
    const surface = typeof window !== "undefined" && window.heorotDesktop ? "desktop" : "web";
    return {
        version: __APP_VERSION__,
        surface,
        buildTime: __APP_BUILD_TIME__,
        label: toLabel(__APP_VERSION__, surface, __APP_BUILD_TIME__),
    };
}

/**
 * Resolves the packaged desktop version when available, falling back to the
 * build-time constant. Async because it crosses the Electron IPC bridge.
 */
export async function resolveAppVersionInfo(): Promise<AppVersionInfo> {
    const build = getBuildVersionInfo();
    const getAppVersion = typeof window !== "undefined" ? window.heorotDesktop?.getAppVersion : undefined;
    if (!getAppVersion) {
        return build;
    }

    try {
        const packaged = await getAppVersion();
        if (typeof packaged === "string" && packaged.length > 0) {
            return { ...build, version: packaged, label: toLabel(packaged, "desktop", build.buildTime) };
        }
    } catch {
        // An older desktop build without the handler - the build constant stands.
    }

    return build;
}

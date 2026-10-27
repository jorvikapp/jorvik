export interface HeorotDesktopMediaAuthState {
    accessToken?: string;
    homeserverUrl?: string;
    versions?: string[];
}

export interface HeorotDesktopCaptureSource {
    id: string;
    name: string;
}

export interface HeorotDesktopNotification {
    title: string;
    body?: string;
    roomId?: string;
    eventId?: string;
}

export interface HeorotDesktopNotificationTarget {
    roomId?: string;
    eventId?: string;
}

/** A running game, as the desktop app's detector names it: "steam-<appid>" for Steam games. */
export interface HeorotDesktopGame {
    id: string;
    name: string;
}

export type HeorotDesktopSsoResult = { loginToken: string } | { cancelled: true } | { timedOut: true };

export interface HeorotDesktopBridge {
    openExternal?: (url: string) => Promise<void>;
    setMediaAuthState?: (state: HeorotDesktopMediaAuthState) => Promise<void>;
    clearMediaAuthState?: () => Promise<void>;
    setCloseOnWindowCloseMinimize?: (enabled: boolean) => Promise<void>;
    setDevToolsEnabled?: (enabled: boolean) => Promise<void>;
    setAppearanceTheme?: (theme: "light" | "dark") => Promise<void>;
    quitApp?: () => Promise<void>;
    getAppVersion?: () => Promise<string>;
    getSystemIdleSeconds?: () => Promise<number>;
    getDesktopCapturerSources?: () => Promise<HeorotDesktopCaptureSource[]>;
    setPreferredDisplayMediaSource?: (sourceId: string) => Promise<void>;
    setBadgeCount?: (count: number) => Promise<void>;
    showNotification?: (notification: HeorotDesktopNotification) => Promise<void>;
    /** Shows the window, from the tray or minimized, and focuses it. */
    focusWindow?: () => Promise<void>;
    /**
     * Starts or stops looking for a running game; resolves to the game running now, if any. Since 1.0.28
     * a game is { id, name }; 1.0.27 sent just the name.
     */
    setGameActivityEnabled?: (enabled: boolean) => Promise<HeorotDesktopGame | string | null>;
    /** False in the Flatpak and Snap builds, which can't see other programs. */
    gameActivitySupported?: () => Promise<boolean>;
    onGameActivity?: (listener: (game: HeorotDesktopGame | string | null) => void) => () => void;
    /** Since 1.0.28: the icon Steam keeps of the running game, as a PNG of at most 64x64; null otherwise. */
    getGameIcon?: (gameId: string) => Promise<Uint8Array | null>;
    onNotificationClicked?: (listener: (target: HeorotDesktopNotificationTarget) => void) => () => void;
    /**
     * Since 1.0.29, single sign-on: listens on a one-time local address and returns it, for the homeserver
     * to send the browser back to with a login token.
     */
    ssoBegin?: () => Promise<string>;
    /** Resolves when the browser comes back with the token, or the wait is cancelled or runs out. */
    ssoWait?: () => Promise<HeorotDesktopSsoResult>;
    ssoCancel?: () => Promise<void>;
    platform?: string;
    versions?: {
        electron?: string;
        chrome?: string;
        node?: string;
    };
}

declare global {
    interface Window {
        heorotDesktop?: HeorotDesktopBridge;
    }
}

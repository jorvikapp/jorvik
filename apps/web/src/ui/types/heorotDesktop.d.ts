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
    onNotificationClicked?: (listener: (target: HeorotDesktopNotificationTarget) => void) => () => void;
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

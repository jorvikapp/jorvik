import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

console.log("[jorvik-preload] loaded");

export interface HeorotDesktopMediaAuthState {
    accessToken?: string;
    homeserverUrl?: string;
    versions?: string[];
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

/** A running game: "steam-<appid>" for a Steam game. */
export interface HeorotDesktopGame {
    id: string;
    name: string;
}

/** How single sign-on in the browser ended. */
export type HeorotDesktopSsoResult = { loginToken: string } | { cancelled: true } | { timedOut: true };

function toGame(value: unknown): HeorotDesktopGame | null {
    const game = value as { id?: unknown; name?: unknown } | null;
    return game && typeof game.id === "string" && typeof game.name === "string" ? { id: game.id, name: game.name } : null;
}

export interface HeorotDesktopBridge {
    openExternal: (url: string) => Promise<void>;
    setMediaAuthState: (state: HeorotDesktopMediaAuthState) => Promise<void>;
    clearMediaAuthState: () => Promise<void>;
    setCloseOnWindowCloseMinimize: (enabled: boolean) => Promise<void>;
    setDevToolsEnabled: (enabled: boolean) => Promise<void>;
    setAppearanceTheme: (theme: "light" | "dark") => Promise<void>;
    quitApp: () => Promise<void>;
    getAppVersion: () => Promise<string>;
    getSystemIdleSeconds: () => Promise<number>;
    getDesktopCapturerSources: () => Promise<Array<{ id: string; name: string }>>;
    setPreferredDisplayMediaSource: (sourceId: string) => Promise<void>;
    setBadgeCount: (count: number) => Promise<void>;
    showNotification: (notification: HeorotDesktopNotification) => Promise<void>;
    focusWindow: () => Promise<void>;
    /** Starts or stops looking for a running game; resolves to the game running now, if any. */
    setGameActivityEnabled: (enabled: boolean) => Promise<HeorotDesktopGame | null>;
    gameActivitySupported: () => Promise<boolean>;
    onGameActivity: (listener: (game: HeorotDesktopGame | null) => void) => () => void;
    /** The icon Steam keeps of the running game, as a PNG; null for other games or when there's none. */
    getGameIcon: (gameId: string) => Promise<Uint8Array | null>;
    onNotificationClicked: (listener: (target: HeorotDesktopNotificationTarget) => void) => () => void;
    /** Single sign-on: a one-time local address for the homeserver to send the browser back to. */
    ssoBegin: () => Promise<string>;
    /** Resolves when the browser comes back with the login token, or the wait is cancelled or runs out. */
    ssoWait: () => Promise<HeorotDesktopSsoResult>;
    ssoCancel: () => Promise<void>;
    platform: NodeJS.Platform;
    versions: {
        electron: string;
        chrome: string;
        node: string;
    };
}

const bridge: HeorotDesktopBridge = {
    openExternal: async (url: string): Promise<void> => {
        await ipcRenderer.invoke("heorot:openExternal", url);
    },
    setMediaAuthState: async (state: HeorotDesktopMediaAuthState): Promise<void> => {
        await ipcRenderer.invoke("heorot:setMediaAuthState", state);
    },
    clearMediaAuthState: async (): Promise<void> => {
        await ipcRenderer.invoke("heorot:clearMediaAuthState");
    },
    setCloseOnWindowCloseMinimize: async (enabled: boolean): Promise<void> => {
        await ipcRenderer.invoke("heorot:setCloseOnWindowCloseMinimize", enabled);
    },
    setDevToolsEnabled: async (enabled: boolean): Promise<void> => {
        await ipcRenderer.invoke("heorot:setDevToolsEnabled", enabled);
    },
    setAppearanceTheme: async (theme: "light" | "dark"): Promise<void> => {
        await ipcRenderer.invoke("heorot:setAppearanceTheme", theme);
    },
    quitApp: async (): Promise<void> => {
        await ipcRenderer.invoke("heorot:quitApp");
    },
    getAppVersion: async (): Promise<string> => {
        return (await ipcRenderer.invoke("heorot:getAppVersion")) as string;
    },
    getSystemIdleSeconds: async (): Promise<number> => {
        return (await ipcRenderer.invoke("heorot:getSystemIdleSeconds")) as number;
    },
    getDesktopCapturerSources: async (): Promise<Array<{ id: string; name: string }>> => {
        return (await ipcRenderer.invoke("heorot:getDesktopCapturerSources")) as Array<{ id: string; name: string }>;
    },
    setPreferredDisplayMediaSource: async (sourceId: string): Promise<void> => {
        await ipcRenderer.invoke("heorot:setPreferredDisplayMediaSource", sourceId);
    },
    setBadgeCount: async (count: number): Promise<void> => {
        await ipcRenderer.invoke("heorot:setBadgeCount", count);
    },
    showNotification: async (notification: HeorotDesktopNotification): Promise<void> => {
        await ipcRenderer.invoke("heorot:showNotification", notification);
    },
    focusWindow: async (): Promise<void> => {
        await ipcRenderer.invoke("heorot:focusWindow");
    },
    setGameActivityEnabled: async (enabled: boolean): Promise<HeorotDesktopGame | null> => {
        return toGame(await ipcRenderer.invoke("heorot:setGameActivityEnabled", enabled));
    },
    gameActivitySupported: async (): Promise<boolean> => {
        return (await ipcRenderer.invoke("heorot:gameActivitySupported")) === true;
    },
    onGameActivity: (listener: (game: HeorotDesktopGame | null) => void): (() => void) => {
        const handler = (_event: IpcRendererEvent, game: unknown): void => {
            listener(toGame(game));
        };
        ipcRenderer.on("heorot:gameActivity", handler);
        return () => ipcRenderer.removeListener("heorot:gameActivity", handler);
    },
    getGameIcon: async (gameId: string): Promise<Uint8Array | null> => {
        const data: unknown = await ipcRenderer.invoke("heorot:getGameIcon", gameId);
        return data instanceof Uint8Array ? new Uint8Array(data) : null;
    },
    onNotificationClicked: (listener: (target: HeorotDesktopNotificationTarget) => void): (() => void) => {
        const handler = (_event: IpcRendererEvent, target: HeorotDesktopNotificationTarget): void => {
            listener(target);
        };
        ipcRenderer.on("heorot:notificationClicked", handler);
        return () => ipcRenderer.removeListener("heorot:notificationClicked", handler);
    },
    ssoBegin: async (): Promise<string> => {
        return (await ipcRenderer.invoke("heorot:ssoBegin")) as string;
    },
    ssoWait: async (): Promise<HeorotDesktopSsoResult> => {
        return (await ipcRenderer.invoke("heorot:ssoWait")) as HeorotDesktopSsoResult;
    },
    ssoCancel: async (): Promise<void> => {
        await ipcRenderer.invoke("heorot:ssoCancel");
    },
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
};

contextBridge.exposeInMainWorld("heorotDesktop", bridge);
console.log("[jorvik-notification] bridge-exposed=true");

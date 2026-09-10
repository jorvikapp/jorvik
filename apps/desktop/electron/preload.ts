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

export interface HeorotDesktopBridge {
    openExternal: (url: string) => Promise<void>;
    setMediaAuthState: (state: HeorotDesktopMediaAuthState) => Promise<void>;
    clearMediaAuthState: () => Promise<void>;
    setCloseOnWindowCloseMinimize: (enabled: boolean) => Promise<void>;
    quitApp: () => Promise<void>;
    getDesktopCapturerSources: () => Promise<Array<{ id: string; name: string }>>;
    setPreferredDisplayMediaSource: (sourceId: string) => Promise<void>;
    setBadgeCount: (count: number) => Promise<void>;
    showNotification: (notification: HeorotDesktopNotification) => Promise<void>;
    onNotificationClicked: (listener: (target: HeorotDesktopNotificationTarget) => void) => () => void;
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
    quitApp: async (): Promise<void> => {
        await ipcRenderer.invoke("heorot:quitApp");
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
    onNotificationClicked: (listener: (target: HeorotDesktopNotificationTarget) => void): (() => void) => {
        const handler = (_event: IpcRendererEvent, target: HeorotDesktopNotificationTarget): void => {
            listener(target);
        };
        ipcRenderer.on("heorot:notificationClicked", handler);
        return () => ipcRenderer.removeListener("heorot:notificationClicked", handler);
    },
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
};

contextBridge.exposeInMainWorld("heorotDesktop", bridge);

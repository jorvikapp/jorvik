import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MatrixEvent, RoomEvent, SyncState } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationsSettings } from "../../../../src/ui/settings/user/settingsStore";

vi.mock("../../../../src/ui/notifications/sound", () => ({ playNotificationSound: async () => undefined }));

const { useElementLikeNotifications } = await import("../../../../src/ui/notifications/useElementLikeNotifications");

const ROOM_ID = "!random:example.org";
const SETTINGS: NotificationsSettings = {
    notificationsEnabled: true,
    notificationBodyEnabled: true,
    audioNotificationsEnabled: false,
    customMessageSoundDataUrl: null,
    customMessageSoundName: null,
};

const shown: FakeNotification[] = [];
class FakeNotification {
    public static permission = "granted";
    public onclick: (() => void) | null = null;
    public closed = false;
    public constructor(public title: string) {
        shown.push(this);
    }
    public close(): void {
        this.closed = true;
    }
}

let container: HTMLDivElement;
let root: Root;

function makeClient() {
    const emitter = new EventEmitter();
    const room = { roomId: ROOM_ID, name: "random", getCanonicalAlias: () => null, getUnreadNotificationCount: () => 1 };
    return Object.assign(emitter, {
        getSyncState: () => SyncState.Syncing,
        getUserId: () => "@me:example.org",
        getDeviceId: () => "DEVICE",
        getAccountData: () => undefined,
        isGuest: () => false,
        getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
        getPushActionsForEvent: () => ({ notify: true, tweaks: {} }),
        decryptEventIfNeeded: async () => undefined,
        removeListener: emitter.removeListener.bind(emitter),
    });
}

function Probe({ client, onOpenRoom }: { client: ReturnType<typeof makeClient>; onOpenRoom: (roomId: string) => void }): null {
    useElementLikeNotifications({
        client: client as never,
        activeRoomId: null,
        hasOpenDialog: false,
        settings: SETTINGS,
        doNotDisturb: false,
        onOpenRoom,
    });
    return null;
}

function bobWrites(client: ReturnType<typeof makeClient>): FakeNotification {
    const event = new MatrixEvent({
        type: "m.room.message",
        room_id: ROOM_ID,
        sender: "@bob:example.org",
        event_id: `$event${shown.length + 1}`,
        content: { msgtype: "m.text", body: "raid at nine" },
    });
    act(() => {
        client.emit(RoomEvent.Timeline, event, undefined, false, false, {
            liveEvent: true,
            timeline: { getTimelineSet: () => ({ threadListType: null }) },
        });
    });
    expect(shown).toHaveLength(1);
    return shown[0];
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    // jsdom has no window focus to give.
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    shown.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.heorotDesktop;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("clicking a notification", () => {
    // It used to only focus the window: the chat stayed closed, and a window in the tray stayed there.
    it("opens its chat and brings the desktop app out of the tray", () => {
        const focusWindow = vi.fn(async () => undefined);
        window.heorotDesktop = { focusWindow };
        const onOpenRoom = vi.fn();
        const client = makeClient();
        act(() => root.render(<Probe client={client} onOpenRoom={onOpenRoom} />));

        const notification = bobWrites(client);
        act(() => notification.onclick?.());

        expect(onOpenRoom).toHaveBeenCalledWith(ROOM_ID);
        expect(focusWindow).toHaveBeenCalledTimes(1);
        expect(window.focus).toHaveBeenCalled();
        expect(notification.closed).toBe(true);
    });

    it("opens its chat in a browser, which has no desktop app to call", () => {
        const onOpenRoom = vi.fn();
        const client = makeClient();
        act(() => root.render(<Probe client={client} onOpenRoom={onOpenRoom} />));

        const notification = bobWrites(client);
        act(() => notification.onclick?.());

        expect(onOpenRoom).toHaveBeenCalledWith(ROOM_ID);
        expect(notification.closed).toBe(true);
    });

    it("uses the newest way of opening a chat, not the one there was when it was shown", () => {
        const first = vi.fn();
        const latest = vi.fn();
        const client = makeClient();
        act(() => root.render(<Probe client={client} onOpenRoom={first} />));
        const notification = bobWrites(client);

        act(() => root.render(<Probe client={client} onOpenRoom={latest} />));
        act(() => notification.onclick?.());

        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledWith(ROOM_ID);
    });
});

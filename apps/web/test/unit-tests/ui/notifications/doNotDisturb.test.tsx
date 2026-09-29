import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MatrixEvent, RoomEvent, SyncState } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationsSettings } from "../../../../src/ui/settings/user/settingsStore";

const playNotificationSound = vi.fn(async () => undefined);
vi.mock("../../../../src/ui/notifications/sound", () => ({
    playNotificationSound: (...args: unknown[]) => playNotificationSound(...(args as [])),
}));

const { useElementLikeNotifications } = await import("../../../../src/ui/notifications/useElementLikeNotifications");

const ROOM_ID = "!room:example.org";
const SETTINGS: NotificationsSettings = {
    notificationsEnabled: true,
    notificationBodyEnabled: true,
    audioNotificationsEnabled: true,
    customMessageSoundDataUrl: null,
    customMessageSoundName: null,
};

const shown: string[] = [];
class FakeNotification {
    public static permission = "granted";
    public onclick: (() => void) | null = null;
    public constructor(title: string) {
        shown.push(title);
    }
    public close(): void {}
}

let container: HTMLDivElement;
let root: Root;
let eventCounter = 0;

function makeClient(highlight = false) {
    const emitter = new EventEmitter();
    const room = {
        roomId: ROOM_ID,
        name: "general",
        getCanonicalAlias: () => null,
        getUnreadNotificationCount: () => 1,
    };
    return Object.assign(emitter, {
        getSyncState: () => SyncState.Syncing,
        getUserId: () => "@me:example.org",
        getDeviceId: () => "DEVICE",
        getAccountData: () => undefined,
        isGuest: () => false,
        getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
        getPushActionsForEvent: () => ({ notify: true, tweaks: { sound: "default", highlight } }),
        decryptEventIfNeeded: async () => undefined,
        removeListener: emitter.removeListener.bind(emitter),
    });
}

function sendMessage(client: ReturnType<typeof makeClient>, body: string): void {
    const event = new MatrixEvent({
        type: "m.room.message",
        room_id: ROOM_ID,
        sender: "@bob:example.org",
        event_id: `$event${++eventCounter}`,
        content: { msgtype: "m.text", body },
    });
    const data = { liveEvent: true, timeline: { getTimelineSet: () => ({ threadListType: null }) } };
    act(() => {
        client.emit(RoomEvent.Timeline, event, undefined, false, false, data);
    });
}

function Probe({ client, doNotDisturb }: { client: ReturnType<typeof makeClient>; doNotDisturb: boolean }): null {
    useElementLikeNotifications({ client: client as never, activeRoomId: null, hasOpenDialog: false, settings: SETTINGS, doNotDisturb });
    return null;
}

function render(client: ReturnType<typeof makeClient>, doNotDisturb: boolean): void {
    act(() => root.render(<Probe client={client} doNotDisturb={doNotDisturb} />));
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    shown.length = 0;
    playNotificationSound.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("useElementLikeNotifications and Do Not Disturb", () => {
    it("shows the popup and plays the sound when not on Do Not Disturb", () => {
        const client = makeClient();
        render(client, false);
        sendMessage(client, "hello");
        expect(shown).toEqual(["general"]);
        expect(playNotificationSound).toHaveBeenCalledTimes(1);
    });

    it("suppresses both on Do Not Disturb, mentions included", () => {
        const client = makeClient(true);
        render(client, true);
        sendMessage(client, "@me look at this");
        expect(shown).toEqual([]);
        expect(playNotificationSound).not.toHaveBeenCalled();
    });

    it("does not replay what arrived during Do Not Disturb, and notifies again after", () => {
        const client = makeClient();
        render(client, true);
        sendMessage(client, "while busy");
        render(client, false);
        expect(shown).toEqual([]);

        sendMessage(client, "after");
        expect(shown).toEqual(["general"]);
        expect(playNotificationSound).toHaveBeenCalledTimes(1);
    });
});

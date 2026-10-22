import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(resolve(__dirname, "../../../public/sw-push.js"), "utf8");
const CHROME = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Mobile Safari/537.36";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1";

interface FakeWindow {
    focused: boolean;
    visibilityState: string;
    onScreen?: string | null;
    focus: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
}

function fakeWindow(onScreen: string | null, focused = true): FakeWindow {
    const win: FakeWindow = {
        focused,
        visibilityState: "visible",
        onScreen,
        focus: vi.fn().mockResolvedValue(undefined),
        postMessage: vi.fn((message: { type: string; roomId: string }, ports?: MessagePort[]) => {
            if (message.type === "jorvik:is_room_open") {
                ports?.[0].postMessage(win.onScreen === message.roomId);
            }
        }),
    };
    return win;
}

function loadWorker({ userAgent = CHROME, windows = [] as FakeWindow[] } = {}) {
    const listeners: Record<string, (event: unknown) => void> = {};
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    const self = {
        navigator: { userAgent, setAppBadge, clearAppBadge },
        registration: { scope: "https://chat.example.org/", showNotification },
        clients: { matchAll: vi.fn().mockResolvedValue(windows), openWindow },
        addEventListener: (type: string, listener: (event: unknown) => void) => {
            listeners[type] = listener;
        },
    };
    vm.runInNewContext(SOURCE, { self, MessageChannel, setTimeout, clearTimeout, URL, console });

    const push = async (payload: unknown): Promise<void> => {
        let done: Promise<unknown> = Promise.resolve();
        listeners.push({ data: { json: () => payload }, waitUntil: (promise: Promise<unknown>) => (done = promise) });
        await done;
    };
    const click = async (data: unknown): Promise<void> => {
        let done: Promise<unknown> = Promise.resolve();
        const notification = { data, close: vi.fn() };
        listeners.notificationclick({ notification, waitUntil: (promise: Promise<unknown>) => (done = promise) });
        await done;
        expect(notification.close).toHaveBeenCalled();
    };
    return { push, click, showNotification, openWindow, setAppBadge, clearAppBadge };
}

const MESSAGE = {
    room_id: "!general:example.org",
    room_name: "general",
    event_id: "$1",
    sender: "@bob:example.org",
    sender_display_name: "bob",
    type: "m.room.message",
    unread: 3,
    content: { msgtype: "m.text", body: "hello there" },
};

describe("sw-push.js", () => {
    it("shows who wrote where, and the text", async () => {
        const worker = loadWorker();
        await worker.push(MESSAGE);

        expect(worker.showNotification).toHaveBeenCalledWith(
            "bob (general)",
            expect.objectContaining({ body: "hello there", tag: "!general:example.org", data: { roomId: "!general:example.org", eventId: "$1" } }),
        );
        expect(worker.setAppBadge).toHaveBeenCalledWith(3);
    });

    it("names a direct chat after the person", async () => {
        const worker = loadWorker();
        await worker.push({ ...MESSAGE, room_name: "bob" });
        expect(worker.showNotification).toHaveBeenCalledWith("bob", expect.objectContaining({ body: "hello there" }));
    });

    it("can't show the text of an encrypted message", async () => {
        const worker = loadWorker();
        await worker.push({ ...MESSAGE, type: "m.room.encrypted", content: { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgA" } });
        expect(worker.showNotification).toHaveBeenCalledWith("bob (general)", expect.objectContaining({ body: "New message" }));
    });

    it("leaves the text out when message bodies are off", async () => {
        const worker = loadWorker();
        await worker.push({ ...MESSAGE, jorvik_hide_body: true });
        expect(worker.showNotification).toHaveBeenCalledWith("bob (general)", expect.objectContaining({ body: "New message" }));
    });

    it("describes pictures, files and invites", async () => {
        const worker = loadWorker();
        await worker.push({ ...MESSAGE, content: { msgtype: "m.image", body: "IMG_0001.jpg" } });
        await worker.push({ room_id: "!new:example.org", room_name: "plans", sender_display_name: "bob", membership: "invite", user_is_target: true, type: "m.room.member", event_id: "$2" });
        expect(worker.showNotification.mock.calls.map((call) => [call[0], call[1].body])).toEqual([
            ["bob (general)", "Sent an image"],
            ["plans", "bob invited you"],
        ]);
    });

    it("stays quiet about a chat you are looking at", async () => {
        const worker = loadWorker({ windows: [fakeWindow("!general:example.org")] });
        await worker.push(MESSAGE);
        expect(worker.showNotification).not.toHaveBeenCalled();
    });

    it("still shows it when you are looking at another chat", async () => {
        const worker = loadWorker({ windows: [fakeWindow("!random:example.org")] });
        await worker.push(MESSAGE);
        expect(worker.showNotification).toHaveBeenCalledTimes(1);
    });

    it("always shows one on Safari, which drops subscriptions that stay quiet", async () => {
        const looking = fakeWindow("!general:example.org");
        const worker = loadWorker({ userAgent: SAFARI, windows: [looking] });
        await worker.push(MESSAGE);
        expect(worker.showNotification).toHaveBeenCalledTimes(1);
        expect(looking.postMessage).not.toHaveBeenCalled();
    });

    it("opens the chat in a Jorvik window that is already open", async () => {
        const win = fakeWindow(null, false);
        const worker = loadWorker({ windows: [win] });
        await worker.click({ roomId: "!general:example.org" });
        expect(win.focus).toHaveBeenCalled();
        expect(win.postMessage).toHaveBeenCalledWith({ type: "jorvik:open_room", roomId: "!general:example.org" });
        expect(worker.openWindow).not.toHaveBeenCalled();
    });

    it("starts Jorvik at that chat when no window is open", async () => {
        const worker = loadWorker();
        await worker.click({ roomId: "!general:example.org" });
        expect(worker.openWindow).toHaveBeenCalledWith("https://chat.example.org/?room=%21general%3Aexample.org");
    });
});

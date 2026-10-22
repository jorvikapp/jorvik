import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    disablePush,
    enablePush,
    getPushAvailability,
    getWebPushConfig,
    isPushEnabledHere,
    PushPermissionError,
    refreshPushRegistration,
    type WebPushConfig,
} from "../../../../src/core/push/webPush";

const VAPID_KEY = "BIP-z4q9E1QtIX05-arlgc8vIJtQrlAHpByyx_2WesuHf69-y5ZyXmB2dwVc9VmLieq0rosPZ_wke-Qd0F6wnvI";
const CONFIG: WebPushConfig = {
    gatewayUrl: "https://matrix.example.org/_matrix/push/v1/notify",
    appId: "app.jorvik.web",
    vapidPublicKey: VAPID_KEY,
};
const ANDROID = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1";

function keyBytes(value: string): ArrayBuffer {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer;
}

function fakeSubscription(p256dh: string, applicationServerKey = keyBytes(VAPID_KEY)) {
    return {
        endpoint: `https://push.example.com/${p256dh}`,
        options: { applicationServerKey },
        toJSON: () => ({ endpoint: `https://push.example.com/${p256dh}`, keys: { p256dh, auth: `auth-${p256dh}` } }),
        unsubscribe: vi.fn().mockResolvedValue(true),
    };
}

let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn>;
let current: ReturnType<typeof fakeSubscription> | null;
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };

function setBrowser({ userAgent = ANDROID, standalone = false, touchPoints = 5 } = {}): void {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: touchPoints });
    Object.defineProperty(navigator, "standalone", { configurable: true, value: standalone });
    window.matchMedia = ((query: string) => ({ matches: standalone && query.includes("standalone") })) as never;
}

function makeClient() {
    return { setPusher: vi.fn().mockResolvedValue({}), removePusher: vi.fn().mockResolvedValue({}) };
}

beforeEach(() => {
    permission = "default";
    requestPermission = vi.fn(async () => {
        permission = "granted";
        return permission;
    });
    (globalThis as { Notification?: unknown }).Notification = {
        get permission() {
            return permission;
        },
        requestPermission,
    };
    current = null;
    pushManager = {
        getSubscription: vi.fn(async () => current),
        subscribe: vi.fn(async () => {
            current = fakeSubscription("p256dh-new");
            return current;
        }),
    };
    const registration = { pushManager };
    Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: { ready: Promise.resolve(registration), getRegistration: async () => registration },
    });
    (window as { PushManager?: unknown }).PushManager = function PushManager() {};
    setBrowser();
});

afterEach(() => {
    delete (globalThis as { Notification?: unknown }).Notification;
    delete (window as { PushManager?: unknown }).PushManager;
});

describe("getWebPushConfig", () => {
    it("reads the gateway from config.json", () => {
        expect(
            getWebPushConfig({
                web_push: { gateway_url: CONFIG.gatewayUrl, app_id: CONFIG.appId, vapid_public_key: VAPID_KEY },
            }),
        ).toEqual(CONFIG);
    });

    it("ignores a gateway the homeserver would refuse, and a missing key", () => {
        expect(getWebPushConfig({ web_push: { gateway_url: "https://push.example.org/", app_id: "a", vapid_public_key: "k" } })).toBeNull();
        expect(getWebPushConfig({ web_push: { gateway_url: CONFIG.gatewayUrl, app_id: CONFIG.appId } })).toBeNull();
        expect(getWebPushConfig({})).toBeNull();
    });
});

describe("getPushAvailability", () => {
    it("sends iPhone users to the Home Screen first", () => {
        setBrowser({ userAgent: IPHONE });
        expect(getPushAvailability()).toBe("needs_home_screen");
    });

    it("works in the Home Screen app on an iPhone", () => {
        setBrowser({ userAgent: IPHONE, standalone: true });
        expect(getPushAvailability()).toBe("available");
    });

    it("works in an Android browser tab", () => {
        expect(getPushAvailability()).toBe("available");
    });

    it("says so where the browser has no push", () => {
        delete (window as { PushManager?: unknown }).PushManager;
        expect(getPushAvailability()).toBe("unsupported");
    });
});

describe("enablePush", () => {
    it("asks first, subscribes with the gateway's key and sets the pusher", async () => {
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: false });

        expect(requestPermission).toHaveBeenCalledTimes(1);
        const options = pushManager.subscribe.mock.calls[0][0];
        expect(options.userVisibleOnly).toBe(true);
        expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual(Array.from(new Uint8Array(keyBytes(VAPID_KEY))));
        expect(client.setPusher).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "http",
                app_id: "app.jorvik.web",
                pushkey: "p256dh-new",
                append: false,
                data: {
                    url: CONFIG.gatewayUrl,
                    endpoint: "https://push.example.com/p256dh-new",
                    auth: "auth-p256dh-new",
                    events_only: true,
                    only_last_per_room: true,
                },
            }),
        );
        expect(isPushEnabledHere()).toBe(true);
    });

    it("tells the gateway to leave message text out when bodies are off", async () => {
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: true });
        expect(client.setPusher.mock.calls[0][0].data.default_payload).toEqual({ jorvik_hide_body: true });
    });

    it("stops when notifications aren't allowed", async () => {
        requestPermission.mockImplementation(async () => {
            permission = "denied";
            return permission;
        });
        const client = makeClient();
        await expect(enablePush(client as never, CONFIG, { hideBody: false })).rejects.toBeInstanceOf(PushPermissionError);
        expect(pushManager.subscribe).not.toHaveBeenCalled();
        expect(client.setPusher).not.toHaveBeenCalled();
        expect(isPushEnabledHere()).toBe(false);
    });

    it("replaces a subscription made for another gateway key", async () => {
        const old = fakeSubscription("p256dh-old", new Uint8Array(65).buffer);
        current = old;
        await enablePush(makeClient() as never, CONFIG, { hideBody: false });
        expect(old.unsubscribe).toHaveBeenCalled();
        expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    });

    it("keeps a subscription already made for this key", async () => {
        current = fakeSubscription("p256dh-kept");
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: false });
        expect(pushManager.subscribe).not.toHaveBeenCalled();
        expect(client.setPusher.mock.calls[0][0].pushkey).toBe("p256dh-kept");
    });
});

describe("disablePush", () => {
    it("removes the pusher and the browser's subscription", async () => {
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: false });
        const subscription = current!;

        await disablePush(client as never, CONFIG);

        expect(client.removePusher).toHaveBeenCalledWith("p256dh-new", "app.jorvik.web");
        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(isPushEnabledHere()).toBe(false);
    });

    it("still unsubscribes when the session has already ended", async () => {
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: false });
        client.removePusher.mockRejectedValue(new Error("M_UNKNOWN_TOKEN"));
        const subscription = current!;

        await disablePush(client as never, CONFIG);

        expect(subscription.unsubscribe).toHaveBeenCalled();
        expect(isPushEnabledHere()).toBe(false);
    });
});

describe("refreshPushRegistration", () => {
    it("does nothing where push was never turned on", async () => {
        const client = makeClient();
        await refreshPushRegistration(client as never, CONFIG, { hideBody: false });
        expect(client.setPusher).not.toHaveBeenCalled();
    });

    it("turns push off when notifications were blocked since", async () => {
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: false });
        permission = "denied";

        await refreshPushRegistration(client as never, CONFIG, { hideBody: false });

        expect(client.removePusher).toHaveBeenCalledWith("p256dh-new", "app.jorvik.web");
        expect(isPushEnabledHere()).toBe(false);
    });

    it("moves the pusher to a subscription the browser replaced", async () => {
        const client = makeClient();
        await enablePush(client as never, CONFIG, { hideBody: false });
        current = fakeSubscription("p256dh-rotated");

        await refreshPushRegistration(client as never, CONFIG, { hideBody: false });

        expect(client.setPusher.mock.calls[1][0].pushkey).toBe("p256dh-rotated");
        expect(client.removePusher).toHaveBeenCalledWith("p256dh-new", "app.jorvik.web");
    });
});

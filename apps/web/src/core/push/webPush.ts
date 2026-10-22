import type { IPusher, IPusherRequest, MatrixClient } from "matrix-js-sdk/src/matrix";

import type { CoreConfig } from "../config/configTypes";

/**
 * Push notifications through the homeserver's push gateway (Sygnal's webpush). The browser gives
 * us a subscription; the homeserver gets a pusher holding it; the gateway encrypts each push for
 * this browser and hands it to the browser maker's push service. public/sw-push.js shows it.
 */
export interface WebPushConfig {
    gatewayUrl: string;
    appId: string;
    vapidPublicKey: string;
}

export interface WebPushOptions {
    // "Show message text in notifications" is off: the gateway adds jorvik_hide_body to every push.
    hideBody: boolean;
}

export type PushAvailability = "available" | "needs_home_screen" | "unsupported";

export class PushPermissionError extends Error {
    public constructor(public readonly permission: NotificationPermission) {
        super(
            permission === "denied"
                ? "Notifications are blocked for Jorvik. Allow them in this browser's settings, then try again."
                : "Jorvik wasn't allowed to show notifications.",
        );
        this.name = "PushPermissionError";
    }
}

// Push is set up per browser (and per Home Screen app), so the choice lives in localStorage.
const ENABLED_KEY = "jorvik_push_enabled";
const PUSHKEY_KEY = "jorvik_push_pushkey";

export function getWebPushConfig(config: CoreConfig | null | undefined): WebPushConfig | null {
    const raw = config?.web_push;
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const gatewayUrl = raw.gateway_url;
    const appId = raw.app_id;
    const vapidPublicKey = raw.vapid_public_key;
    // The homeserver only calls gateways at this path.
    if (typeof gatewayUrl !== "string" || !gatewayUrl.endsWith("/_matrix/push/v1/notify")) {
        return null;
    }
    if (typeof appId !== "string" || !appId || typeof vapidPublicKey !== "string" || !vapidPublicKey) {
        return null;
    }
    return { gatewayUrl, appId, vapidPublicKey };
}

function isAppleTouchDevice(): boolean {
    const userAgent = navigator.userAgent;
    // iPads ask for the desktop site, so they say Macintosh but have a touch screen.
    return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
}

function isHomeScreenApp(): boolean {
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    return standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function getPushAvailability(): PushAvailability {
    if (typeof window === "undefined") {
        return "unsupported";
    }
    // iPhones and iPads only let apps added to the Home Screen receive pushes.
    if (isAppleTouchDevice() && !isHomeScreenApp()) {
        return "needs_home_screen";
    }
    const supported = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
    return supported ? "available" : "unsupported";
}

function readStorage(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string | null): void {
    try {
        if (value === null) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // Private browsing can refuse storage; push then just isn't remembered.
    }
}

export function isPushEnabledHere(): boolean {
    return readStorage(ENABLED_KEY) === "1";
}

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
    if (!a || a.byteLength !== b.byteLength) {
        return false;
    }
    const bytes = new Uint8Array(a);
    return bytes.every((byte, index) => byte === b[index]);
}

function describeDevice(): string {
    const userAgent = navigator.userAgent;
    const platform = /iPhone/.test(userAgent)
        ? "iPhone"
        : /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
          ? "iPad"
          : /Android/.test(userAgent)
            ? "Android"
            : /Macintosh/.test(userAgent)
              ? "Mac"
              : /Windows/.test(userAgent)
                ? "Windows"
                : /Linux/.test(userAgent)
                  ? "Linux"
                  : null;
    return platform ? `Jorvik on ${platform}` : "Jorvik";
}

async function subscribe(registration: ServiceWorkerRegistration, vapidPublicKey: string): Promise<PushSubscription> {
    const applicationServerKey = base64UrlToBytes(vapidPublicKey);
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
        if (sameBytes(existing.options.applicationServerKey, applicationServerKey)) {
            return existing;
        }
        // Made for another gateway key, so every push signed with ours would be refused.
        await existing.unsubscribe();
    }
    return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

async function setPusher(
    client: MatrixClient,
    config: WebPushConfig,
    subscription: PushSubscription,
    options: WebPushOptions,
): Promise<string> {
    const { endpoint, keys } = subscription.toJSON();
    const pushkey = keys?.p256dh;
    const auth = keys?.auth;
    if (!endpoint || !pushkey || !auth) {
        throw new Error("The browser gave Jorvik an incomplete push subscription.");
    }
    const pusher: IPusherRequest = {
        kind: "http",
        app_id: config.appId,
        pushkey,
        app_display_name: "Jorvik",
        device_display_name: describeDevice(),
        lang: navigator.language || "en",
        // Another account signed in here before keeps no pushes for this browser.
        append: false,
        data: {
            url: config.gatewayUrl,
            // The rest is read by the gateway, not the homeserver.
            endpoint,
            auth,
            // No pushes for counts that changed because you read something elsewhere: iPhones
            // drop the subscription when a push arrives without a notification to show.
            events_only: true,
            only_last_per_room: true,
            ...(options.hideBody ? { default_payload: { jorvik_hide_body: true } } : {}),
        } as IPusher["data"],
    };
    await client.setPusher(pusher);
    return pushkey;
}

/** Asks for permission and turns push on for this browser. Call it straight from a tap. */
export async function enablePush(client: MatrixClient, config: WebPushConfig, options: WebPushOptions): Promise<void> {
    // First, while the tap that got us here still counts as the user's: Safari insists on that.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        throw new PushPermissionError(permission);
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await subscribe(registration, config.vapidPublicKey);
    const pushkey = await setPusher(client, config, subscription, options);
    writeStorage(PUSHKEY_KEY, pushkey);
    writeStorage(ENABLED_KEY, "1");
}

/** Turns push off here: removes the pusher (when the session still works) and the subscription. */
export async function disablePush(client: MatrixClient | null, config: WebPushConfig | null): Promise<void> {
    const pushkey = readStorage(PUSHKEY_KEY);
    writeStorage(ENABLED_KEY, null);
    writeStorage(PUSHKEY_KEY, null);
    if (client && config && pushkey) {
        try {
            await client.removePusher(pushkey, config.appId);
        } catch {
            // A session that has ended took its pushers with it.
        }
    }
    try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        await subscription?.unsubscribe();
    } catch {
        // Nothing left to undo.
    }
}

/**
 * On every start with push on: browsers can replace a subscription, and the homeserver can lose
 * a pusher, so this sets it again. It turns push off if notifications were blocked meanwhile.
 */
export async function refreshPushRegistration(
    client: MatrixClient,
    config: WebPushConfig,
    options: WebPushOptions,
): Promise<void> {
    if (!isPushEnabledHere()) {
        return;
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
        await disablePush(client, config);
        return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await subscribe(registration, config.vapidPublicKey);
    const previous = readStorage(PUSHKEY_KEY);
    const pushkey = await setPusher(client, config, subscription, options);
    writeStorage(PUSHKEY_KEY, pushkey);
    if (previous && previous !== pushkey) {
        try {
            await client.removePusher(previous, config.appId);
        } catch {
            // Already gone.
        }
    }
}

import { ClientPrefix, Method, type MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * "On their phone": a green phone in place of the green dot while someone is using Jorvik on a phone.
 *
 * Matrix presence says whether someone is online, not on which device, so each app says it itself in an
 * extended profile field (MSC4133), like the bio:
 *
 *     "app.jorvik.on_phone": true        (absent when the device in use is a computer)
 *
 * The device that is actually being used writes it: when someone touches, types in or comes back to
 * Jorvik, the app sets it if it's a phone and removes it if it's a computer, and only when that changes
 * what the field already says. An app left open but unused on another device never writes, so two
 * devices don't take turns. Others read it while that person shows as online, idle or busy, and look
 * again every few minutes and whenever their presence changes. Offline and invisible never show it.
 */
export const ON_PHONE_FIELD = "app.jorvik.on_phone";

/** A touch screen with no mouse: a phone or tablet. A narrow window on a computer doesn't count. */
export const PHONE_DEVICE_QUERY = "(pointer: coarse) and (hover: none)";

/** How long someone's answer is trusted before it's fetched again. */
export const ON_PHONE_FRESH_MS = 3 * 60_000;
/** Using the app writes at most this often. */
const WRITE_AT_MOST_EVERY_MS = 60_000;
/** Fetches at the same time, so a long member list doesn't send a hundred at once. */
const MAX_FETCHES = 4;

export function isPhoneDevice(): boolean {
    try {
        return typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia(PHONE_DEVICE_QUERY).matches
            : false;
    } catch {
        return false;
    }
}

/**
 * The stored value as a yes or no. Synapse on SQLite hands a stored `true` back as `1`, so that counts too;
 * anything else is no.
 */
export function onPhoneFrom(value: unknown): boolean {
    return value === true || value === 1;
}

function isNotFound(error: unknown): boolean {
    const e = error as { httpStatus?: number; errcode?: string } | null;
    return e?.httpStatus === 404 || e?.errcode === "M_NOT_FOUND";
}

/**
 * Reads the field straight from the server. Not getExtendedProfileProperty: that keeps the first answer
 * in the SDK's store and returns it from then on, so someone would stay "on their phone" for good.
 */
export async function fetchOnPhone(client: MatrixClient, userId: string): Promise<boolean> {
    try {
        const body = await client.http.authedRequest<Record<string, unknown>>(
            Method.Get,
            `/profile/${encodeURIComponent(userId)}/${encodeURIComponent(ON_PHONE_FIELD)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        return onPhoneFrom(body?.[ON_PHONE_FIELD]);
    } catch (error) {
        if (isNotFound(error)) {
            return false;
        }
        throw error;
    }
}

interface Entry {
    phone: boolean;
    at: number;
}

/** Who is on their phone, fetched as views ask and kept fresh while something shows them. */
export class OnPhoneStore {
    private readonly entries = new Map<string, Entry>();
    private readonly watchers = new Map<string, number>();
    private readonly listeners = new Set<() => void>();
    private readonly inFlight = new Set<string>();
    private readonly queue: string[] = [];
    private supported: boolean | undefined;
    private supportCheck: Promise<boolean> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    public constructor(
        private readonly client: MatrixClient,
        private readonly now: () => number = Date.now,
    ) {}

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    /** True when this person was on their phone when last looked. Unknown counts as no. */
    public isOnPhone(userId: string): boolean {
        return this.entries.get(userId)?.phone ?? false;
    }

    /** A view showing this person's presence: keeps their answer fresh until the returned function runs. */
    public watch(userId: string): () => void {
        this.watchers.set(userId, (this.watchers.get(userId) ?? 0) + 1);
        this.refreshIfStale(userId);
        this.startTimer();
        return () => {
            const left = (this.watchers.get(userId) ?? 1) - 1;
            if (left > 0) {
                this.watchers.set(userId, left);
            } else {
                this.watchers.delete(userId);
            }
        };
    }

    /** Their presence changed (came online, switched device): look again now. */
    public invalidate(userId: string): void {
        const entry = this.entries.get(userId);
        if (entry) {
            this.entries.set(userId, { ...entry, at: 0 });
        }
        if (this.watchers.has(userId)) {
            this.refreshIfStale(userId);
        }
    }

    /** What this app just wrote for its own user, so its own avatar changes at once. */
    public remember(userId: string, phone: boolean): void {
        const before = this.entries.get(userId)?.phone;
        this.entries.set(userId, { phone, at: this.now() });
        if (before !== phone) {
            this.emit();
        }
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.listeners.clear();
    }

    private startTimer(): void {
        if (this.timer || typeof setInterval !== "function") {
            return;
        }
        this.timer = setInterval(() => {
            for (const userId of this.watchers.keys()) {
                this.refreshIfStale(userId);
            }
        }, 30_000);
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private refreshIfStale(userId: string): void {
        const entry = this.entries.get(userId);
        if (entry && this.now() - entry.at < ON_PHONE_FRESH_MS) {
            return;
        }
        if (this.inFlight.has(userId) || this.queue.includes(userId)) {
            return;
        }
        this.queue.push(userId);
        this.pump();
    }

    private isSupported(): Promise<boolean> {
        if (this.supported !== undefined) {
            return Promise.resolve(this.supported);
        }
        this.supportCheck ??= this.client
            .doesServerSupportExtendedProfiles()
            .catch(() => false)
            .then((supported) => {
                this.supported = supported;
                return supported;
            });
        return this.supportCheck;
    }

    private pump(): void {
        while (this.inFlight.size < MAX_FETCHES && this.queue.length > 0) {
            const userId = this.queue.shift()!;
            this.inFlight.add(userId);
            void this.fetch(userId).finally(() => {
                this.inFlight.delete(userId);
                this.pump();
            });
        }
    }

    private async fetch(userId: string): Promise<void> {
        if (!(await this.isSupported())) {
            return;
        }
        let phone: boolean;
        try {
            phone = await fetchOnPhone(this.client, userId);
        } catch {
            // Couldn't ask (server away, remote server down): keep what we had, try again later.
            const entry = this.entries.get(userId);
            this.entries.set(userId, { phone: entry?.phone ?? false, at: this.now() });
            return;
        }
        this.remember(userId, phone);
    }
}

/**
 * Keeps this app's own answer up to date: on start, and whenever the person uses it (at most once a
 * minute), it writes whether this device is a phone, if that differs from what the field says.
 * Returns a function that stops it.
 */
export function startOnPhoneWriter(
    client: MatrixClient,
    store: OnPhoneStore | null,
    { isPhone = isPhoneDevice, now = Date.now }: { isPhone?: () => boolean; now?: () => number } = {},
): () => void {
    const userId = client.getUserId();
    if (!userId || typeof window === "undefined") {
        return () => undefined;
    }
    let stopped = false;
    let known: boolean | undefined;
    let lastCheck = Number.NEGATIVE_INFINITY;
    let writing = false;

    const write = async (): Promise<void> => {
        if (writing || stopped) {
            return;
        }
        writing = true;
        try {
            if (!(await client.doesServerSupportExtendedProfiles().catch(() => false))) {
                stopped = true;
                return;
            }
            if (known === undefined) {
                known = await fetchOnPhone(client, userId);
            }
            const phone = isPhone();
            if (phone !== known) {
                if (phone) {
                    await client.setExtendedProfileProperty(ON_PHONE_FIELD, true);
                } else {
                    await client.deleteExtendedProfileProperty(ON_PHONE_FIELD);
                }
                known = phone;
            }
            store?.remember(userId, phone);
        } catch {
            // Server away: the next use tries again.
            known = undefined;
            lastCheck = Number.NEGATIVE_INFINITY;
        } finally {
            writing = false;
        }
    };

    const onUse = (): void => {
        if (stopped || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
            return;
        }
        const t = now();
        if (t - lastCheck < WRITE_AT_MOST_EVERY_MS) {
            return;
        }
        lastCheck = t;
        // Another device may have written since: read it again before deciding.
        known = undefined;
        void write();
    };

    const events = ["pointerdown", "keydown", "touchstart", "focus"] as const;
    for (const name of events) {
        window.addEventListener(name, onUse, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", onUse);
    onUse();

    return () => {
        stopped = true;
        for (const name of events) {
            window.removeEventListener(name, onUse, { capture: true });
        }
        document.removeEventListener("visibilitychange", onUse);
    };
}

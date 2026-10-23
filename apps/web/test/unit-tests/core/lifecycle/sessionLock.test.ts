import { afterEach, describe, expect, it, vi } from "vitest";

import { HAND_OVER_TIMEOUT_MS, SessionLock } from "../../../../src/core/lifecycle/sessionLock";

/** One lock name, with the Web Locks behaviours SessionLock uses: ifAvailable, queueing, signal and steal. */
class FakeLocks {
    private holder: { rejectReleased: (error: unknown) => void } | null = null;
    private queue: Array<() => void> = [];

    public request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const grant = (): void => {
                const held = { rejectReleased: reject };
                this.holder = held;
                Promise.resolve(callback({ name, mode: "exclusive" } as Lock)).then((value) => {
                    if (this.holder === held) {
                        this.holder = null;
                        this.queue.shift()?.();
                    }
                    resolve(value);
                }, reject);
            };
            if (options.steal) {
                this.holder?.rejectReleased(new DOMException("Lock stolen", "AbortError"));
                this.holder = null;
                grant();
            } else if (!this.holder) {
                grant();
            } else if (options.ifAvailable) {
                Promise.resolve(callback(null)).then(resolve, reject);
            } else {
                const waiting = (): void => grant();
                this.queue.push(waiting);
                options.signal?.addEventListener("abort", () => {
                    this.queue = this.queue.filter((candidate) => candidate !== waiting);
                    reject(new DOMException("Aborted", "AbortError"));
                });
            }
        });
    }
}

/** Tabs' BroadcastChannels: a message reaches every other tab, a moment later. */
class FakeBus {
    private readonly channels: FakeChannel[] = [];

    public channel(): BroadcastChannel {
        const channel = new FakeChannel(this.channels);
        this.channels.push(channel);
        return channel as unknown as BroadcastChannel;
    }
}

class FakeChannel {
    private readonly listeners: Array<(event: MessageEvent) => void> = [];

    public constructor(private readonly all: FakeChannel[]) {}

    public addEventListener(_type: string, listener: (event: MessageEvent) => void): void {
        this.listeners.push(listener);
    }

    public postMessage(data: unknown): void {
        for (const other of this.all) {
            if (other !== this) {
                setTimeout(() => other.listeners.forEach((listener) => listener({ data } as MessageEvent)), 0);
            }
        }
    }
}

afterEach(() => {
    vi.useRealTimers();
});

describe("SessionLock", () => {
    it("lets the first tab run Jorvik, and not a second one", async () => {
        const locks = new FakeLocks();
        const bus = new FakeBus();
        const first = new SessionLock(locks, bus.channel());
        const second = new SessionLock(locks, bus.channel());

        expect(await first.acquire()).toBe(true);
        expect(await second.acquire()).toBe(false);
        expect(first.held).toBe(true);
        expect(second.held).toBe(false);
    });

    it("hands over when another tab asks, stopping before the lock passes on", async () => {
        const locks = new FakeLocks();
        const bus = new FakeBus();
        const first = new SessionLock(locks, bus.channel());
        const second = new SessionLock(locks, bus.channel());
        await first.acquire();
        let secondHeldWhenFirstStopped: boolean | null = null;
        first.onLost(() => {
            secondHeldWhenFirstStopped = second.held;
        });

        await second.takeOver();

        expect(secondHeldWhenFirstStopped).toBe(false);
        expect(second.held).toBe(true);
        expect(first.held).toBe(false);
        expect(await first.acquire()).toBe(false);
    });

    it("takes the lock anyway from a tab that doesn't answer, which then stops", async () => {
        vi.useFakeTimers();
        const locks = new FakeLocks();
        const bus = new FakeBus();
        // A tab the phone froze in the background: it never hears the request.
        const frozen = new SessionLock(locks, null);
        const second = new SessionLock(locks, bus.channel());
        await frozen.acquire();
        const lost = vi.fn();
        frozen.onLost(lost);

        const takingOver = second.takeOver();
        await vi.advanceTimersByTimeAsync(HAND_OVER_TIMEOUT_MS - 1);
        expect(second.held).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await takingOver;

        expect(second.held).toBe(true);
        expect(frozen.held).toBe(false);
        expect(lost).toHaveBeenCalledTimes(1);
    });

    it("takes the lock straight away when no tab has it", async () => {
        const locks = new FakeLocks();
        const tab = new SessionLock(locks, new FakeBus().channel());

        await tab.takeOver();

        expect(tab.held).toBe(true);
    });

    it("lets every tab run where the browser has no Web Locks, as before", async () => {
        expect(await new SessionLock(undefined, null).acquire()).toBe(true);
        expect(await new SessionLock(undefined, null).acquire()).toBe(true);
    });
});

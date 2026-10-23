/**
 * Jorvik runs in one tab at a time. Two tabs on one session refresh the same token at the same
 * moment, and the server then revokes the tokens it just gave one of them, signing that tab out;
 * they would also share one encryption store, which isn't safe to use from two places at once.
 * The tab holding this lock runs Jorvik, and another tab can ask for it ("Use Jorvik here").
 */
const LOCK_NAME = "jorvik-session";
const CHANNEL_NAME = "jorvik-session";
const HAND_OVER_MESSAGE = "hand_over";
/** How long the tab running Jorvik gets to stop before the lock is taken from it anyway. */
export const HAND_OVER_TIMEOUT_MS = 3000;

type LockManagerLike = Pick<LockManager, "request">;

export class SessionLock {
    private releaseHeld: (() => void) | null = null;
    private readonly lostListeners = new Set<() => void>();
    private readonly channel: BroadcastChannel | null;

    public constructor(
        private readonly locks: LockManagerLike | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
        channel: BroadcastChannel | null = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME),
    ) {
        this.channel = channel;
        this.channel?.addEventListener("message", (event: MessageEvent) => {
            if ((event.data as { type?: unknown } | null)?.type === HAND_OVER_MESSAGE && this.releaseHeld) {
                this.lose();
            }
        });
    }

    public get held(): boolean {
        return this.releaseHeld !== null;
    }

    /** Takes the lock if no other tab has it. Without Web Locks every tab runs, as before. */
    public async acquire(): Promise<boolean> {
        if (!this.locks || this.releaseHeld) {
            return true;
        }
        return this.request({ ifAvailable: true });
    }

    /** Asks the tab running Jorvik to stop, and takes the lock once it has, or after a moment regardless. */
    public async takeOver(): Promise<void> {
        if (!this.locks || this.releaseHeld) {
            return;
        }
        this.channel?.postMessage({ type: HAND_OVER_MESSAGE });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HAND_OVER_TIMEOUT_MS);
        const granted = await this.request({ signal: controller.signal }).catch(() => false);
        clearTimeout(timer);
        if (!granted) {
            // That tab didn't answer, e.g. a phone froze it in the background.
            await this.request({ steal: true });
        }
    }

    /** Runs when another tab takes Jorvik over, before this tab lets go of the lock. */
    public onLost(listener: () => void): () => void {
        this.lostListeners.add(listener);
        return () => {
            this.lostListeners.delete(listener);
        };
    }

    private request(options: LockOptions): Promise<boolean> {
        const locks = this.locks!;
        return new Promise<boolean>((resolve, reject) => {
            let granted = false;
            locks
                .request(LOCK_NAME, options, (lock) => {
                    if (!lock) {
                        resolve(false);
                        return undefined;
                    }
                    granted = true;
                    resolve(true);
                    return new Promise<void>((release) => {
                        this.releaseHeld = release;
                    });
                })
                .catch((error: unknown) => {
                    if (!granted) {
                        reject(error);
                        return;
                    }
                    // Another tab took the lock without waiting for this one.
                    if (this.releaseHeld) {
                        this.releaseHeld = null;
                        this.notifyLost();
                    }
                });
        });
    }

    private lose(): void {
        const release = this.releaseHeld;
        this.releaseHeld = null;
        this.notifyLost();
        release?.();
    }

    private notifyLost(): void {
        for (const listener of this.lostListeners) {
            listener();
        }
    }
}

const HANDED_OVER_KEY = "jorvik.handed_over";

/**
 * A tab that hands Jorvik over reloads into the "open in another tab" screen, which opens none of
 * the stores the other tab now uses. This tells it not to take the lock straight back.
 */
export function markHandedOver(): void {
    try {
        window.sessionStorage.setItem(HANDED_OVER_KEY, "1");
    } catch {
        // Without session storage it asks for the lock, which the other tab already has.
    }
}

export function consumeHandedOver(): boolean {
    try {
        const handedOver = window.sessionStorage.getItem(HANDED_OVER_KEY) === "1";
        window.sessionStorage.removeItem(HANDED_OVER_KEY);
        return handedOver;
    } catch {
        return false;
    }
}

let sessionLock: SessionLock | null = null;

export function getSessionLock(): SessionLock {
    sessionLock ??= new SessionLock();
    return sessionLock;
}

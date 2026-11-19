import type { UserId } from "@matrix-org/matrix-sdk-crypto-wasm";
import { logger } from "matrix-js-sdk/src/logger";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    ACTIVITY_EVENT,
    ACTIVITY_HEARTBEAT_MS,
    playingContent,
    sameActivity,
    sameGame,
    stoppedContent,
    type ActivityContent,
    type ActivityGame,
    type ActivityMusic,
    type SharedActivity,
} from "./activityWire";

/**
 * Keeps the people who may see the user's game and music up to date (see activityWire.ts for the
 * message):
 *
 * - a game starts or music plays: everyone picked is told, then again every few minutes while it
 *   lasts, and again when its icon or cover is ready;
 * - the game changes, or its icon is ready: everyone is told at once;
 * - the track changes: everyone is told, but no more often than every MIN_CHANGE_INTERVAL_MS, so
 *   skipping through a playlist sends only where it ends up;
 * - someone drops out of the picked people (a space switched off, a DM left): they're told it stopped;
 * - someone new is picked: they're told what's going on;
 * - everything stops, sharing is turned off or the game is hidden: everyone told is told it stopped.
 */

/** Changes go out at most this often; receivers take at most six messages a minute from a device. */
export const MIN_CHANGE_INTERVAL_MS = 15_000;

export interface PlayingGame extends ActivityGame {
    startedAt: number;
}

export interface SharedNow {
    game: PlayingGame | null;
    music: ActivityMusic | null;
}

function hasAnything(activity: SharedNow | null): activity is SharedNow {
    return Boolean(activity && (activity.game || activity.music));
}

function wire(activity: SharedNow): SharedActivity {
    const game = activity.game ? { id: activity.game.id, name: activity.game.name, ...(activity.game.icon ? { icon: activity.game.icon } : {}) } : null;
    return { game, music: activity.music };
}

export interface ActivityTransport {
    send(userIds: readonly string[], content: ActivityContent): Promise<void>;
}

export class ActivitySender {
    private activity: SharedNow | null = null;
    private recipients = new Set<string>();
    /** What the current recipients were told about; null when they weren't told anything. */
    private told: SharedActivity | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private sending: Promise<void> = Promise.resolve();
    private lastChangeAt = Number.NEGATIVE_INFINITY;
    private pendingChange: ReturnType<typeof setTimeout> | null = null;

    public constructor(
        private readonly transport: ActivityTransport,
        private readonly deviceId: string,
        private readonly now: () => number = Date.now,
    ) {}

    /** What may be shared now (null or nothing set: nothing), and who may know. */
    public update(activity: SharedNow | null, recipients: readonly string[]): void {
        const current = hasAnything(activity) ? activity : null;
        const next = new Set(current ? recipients : []);
        const removed = [...this.recipients].filter((userId) => !next.has(userId));
        const added = [...next].filter((userId) => !this.recipients.has(userId));

        this.activity = current;
        this.recipients = next;

        if (removed.length > 0) {
            this.send(removed, stoppedContent(this.deviceId));
        }
        if (!current || next.size === 0) {
            this.cancelPendingChange();
            this.told = null;
            this.scheduleHeartbeat(false);
            return;
        }
        const telling = wire(current);
        if (this.told && !sameGame(telling.game, this.told.game)) {
            this.cancelPendingChange();
            this.told = telling;
            this.lastChangeAt = this.now();
            this.send([...next], this.content(telling));
            this.scheduleHeartbeat(true);
            return;
        }
        if (this.told && !sameActivity(telling, this.told)) {
            // Newcomers hear about it now; everyone else with the next change.
            if (added.length > 0) {
                this.send(added, this.content(this.told));
            }
            this.queueChange();
            return;
        }
        if (!this.told) {
            this.told = telling;
            this.lastChangeAt = this.now();
            this.send([...next], this.content(telling));
            this.scheduleHeartbeat(true);
            return;
        }
        if (added.length > 0) {
            this.send(added, this.content(this.told));
        }
    }

    /** Tells everyone who was told that it stopped. */
    public stop(): void {
        this.update(null, []);
    }

    private content(activity: SharedActivity): ActivityContent {
        return playingContent(this.deviceId, activity, this.activity?.game?.startedAt ?? this.now(), this.now());
    }

    /** Sends the latest activity to everyone, now or once MIN_CHANGE_INTERVAL_MS has passed since the last change. */
    private queueChange(): void {
        if (this.pendingChange) {
            return;
        }
        const wait = Math.max(0, this.lastChangeAt + MIN_CHANGE_INTERVAL_MS - this.now());
        const flushChange = (): void => {
            this.pendingChange = null;
            if (!this.activity || this.recipients.size === 0) {
                return;
            }
            const telling = wire(this.activity);
            if (this.told && sameActivity(telling, this.told)) {
                return;
            }
            this.told = telling;
            this.lastChangeAt = this.now();
            this.send([...this.recipients], this.content(telling));
            this.scheduleHeartbeat(true);
        };
        if (wait === 0) {
            flushChange();
        } else {
            this.pendingChange = setTimeout(flushChange, wait);
        }
    }

    private cancelPendingChange(): void {
        if (this.pendingChange) {
            clearTimeout(this.pendingChange);
            this.pendingChange = null;
        }
    }

    /** Resolves once everything handed to the transport so far has gone. */
    public flush(): Promise<void> {
        return this.sending;
    }

    private scheduleHeartbeat(restart: boolean): void {
        const needed = this.told !== null;
        if (this.heartbeat && (!needed || restart)) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        if (needed && !this.heartbeat) {
            this.heartbeat = setInterval(() => {
                if (this.activity && this.told !== null) {
                    this.send([...this.recipients], this.content(this.told));
                }
            }, ACTIVITY_HEARTBEAT_MS);
        }
    }

    private send(userIds: readonly string[], content: ActivityContent): void {
        // In order, so a "stopped" can't overtake the "playing" before it.
        this.sending = this.sending
            .then(() => this.transport.send(userIds, content))
            .catch((error: unknown) => logger.warn("[Jorvik activity] could not send", error));
    }
}

type Crypto = NonNullable<ReturnType<MatrixClient["getCrypto"]>>;

interface CryptoInternals {
    olmMachine?: { updateTrackedUsers?: (users: UserId[]) => Promise<void> };
    outgoingRequestsManager?: { doProcessOutgoingRequests?: () => Promise<void> };
}

/**
 * The crypto layer only encrypts for devices it keeps track of, and it tracks the members of encrypted
 * rooms; someone the user only shares an unencrypted space with would be skipped. So it's asked to
 * track the recipients and fetch their devices first, the way matrix-js-sdk's own room encryption
 * does. There's no public call for that; if a newer matrix-js-sdk moves these, the activity still
 * reaches everyone already tracked.
 */
async function trackDevices(crypto: Crypto, userIds: readonly string[]): Promise<void> {
    const internals = crypto as unknown as CryptoInternals;
    const track = internals.olmMachine?.updateTrackedUsers;
    const fetchDevices = internals.outgoingRequestsManager?.doProcessOutgoingRequests;
    if (typeof track !== "function" || typeof fetchDevices !== "function") {
        logger.warn("[Jorvik activity] can't ask the crypto layer to track recipients; only tracked ones are told");
        return;
    }
    // Loaded with the crypto layer already (matrix-js-sdk imports it lazily), so this costs nothing more.
    const wasm = await import("@matrix-org/matrix-sdk-crypto-wasm");
    await track.call(internals.olmMachine, userIds.map((userId) => new wasm.UserId(userId)));
    await fetchDevices.call(internals.outgoingRequestsManager);
}

/** Encrypts the message for every device of the given people and queues it; the client retries failed sends. */
export function matrixActivityTransport(client: MatrixClient): ActivityTransport {
    return {
        async send(userIds, content): Promise<void> {
            const crypto = client.getCrypto();
            if (!crypto || userIds.length === 0) {
                return;
            }
            await trackDevices(crypto, userIds);
            const deviceMap = await crypto.getUserDeviceInfo([...userIds]);
            const devices: { userId: string; deviceId: string }[] = [];
            for (const [userId, userDevices] of deviceMap) {
                for (const device of userDevices.values()) {
                    // A dehydrated device only holds keys for when its owner signs in again.
                    if (!device.dehydrated) {
                        devices.push({ userId, deviceId: device.deviceId });
                    }
                }
            }
            if (devices.length === 0) {
                return;
            }
            const batch = await crypto.encryptToDeviceMessages(ACTIVITY_EVENT, devices, { ...content });
            if (batch.batch.length > 0) {
                await client.queueToDevice(batch);
            }
        },
    };
}

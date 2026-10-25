import type { UserId } from "@matrix-org/matrix-sdk-crypto-wasm";
import { logger } from "matrix-js-sdk/src/logger";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    ACTIVITY_EVENT,
    ACTIVITY_HEARTBEAT_MS,
    playingContent,
    sameGame,
    stoppedContent,
    type ActivityContent,
    type ActivityGame,
} from "./activityWire";

/**
 * Keeps the people who may see the user's game up to date (see activityWire.ts for the message):
 *
 * - a game starts: everyone picked is told at once, then again every few minutes while it runs, and
 *   again when its icon is ready;
 * - someone drops out of the picked people (a space switched off, a DM left): they're told it stopped;
 * - someone new is picked: they're told what's running;
 * - the game stops, sharing is turned off or the game is hidden: everyone told is told it stopped.
 */

export interface PlayingGame extends ActivityGame {
    startedAt: number;
}

export interface ActivityTransport {
    send(userIds: readonly string[], content: ActivityContent): Promise<void>;
}

export class ActivitySender {
    private game: PlayingGame | null = null;
    private recipients = new Set<string>();
    /** The game the current recipients were told about; null when they weren't told anything. */
    private toldGame: ActivityGame | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private sending: Promise<void> = Promise.resolve();

    public constructor(
        private readonly transport: ActivityTransport,
        private readonly deviceId: string,
        private readonly now: () => number = Date.now,
    ) {}

    /** What is running and may be shared (null: nothing), and who may know. */
    public update(game: PlayingGame | null, recipients: readonly string[]): void {
        const next = new Set(game ? recipients : []);
        const removed = [...this.recipients].filter((userId) => !next.has(userId));
        const telling = game && next.size > 0 ? game : null;
        const gameChanged = !sameGame(telling, this.toldGame);
        const added = gameChanged ? [...next] : [...next].filter((userId) => !this.recipients.has(userId));

        this.game = game;
        this.recipients = next;
        this.toldGame = telling;

        if (removed.length > 0) {
            this.send(removed, stoppedContent(this.deviceId));
        }
        if (game && added.length > 0) {
            this.send(added, playingContent(this.deviceId, game, game.startedAt, this.now()));
        }
        this.scheduleHeartbeat(gameChanged);
    }

    /** Tells everyone who was told that it stopped. */
    public stop(): void {
        this.update(null, []);
    }

    /** Resolves once everything handed to the transport so far has gone. */
    public flush(): Promise<void> {
        return this.sending;
    }

    private scheduleHeartbeat(restart: boolean): void {
        const needed = this.toldGame !== null;
        if (this.heartbeat && (!needed || restart)) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        if (needed && !this.heartbeat) {
            this.heartbeat = setInterval(() => {
                if (this.game && this.toldGame !== null) {
                    this.send([...this.recipients], playingContent(this.deviceId, this.game, this.game.startedAt, this.now()));
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

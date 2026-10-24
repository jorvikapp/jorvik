import { ClientEvent, KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import type { ReceivedToDeviceMessage } from "matrix-js-sdk/src/sync-accumulator";

import { getDirectRoomIds } from "../dm/directChats";
import {
    ACTIVITY_EVENT,
    contentDeviceId,
    parseIncomingActivity,
    type ActivityGame,
    type IncomingActivity,
} from "./activityWire";

/**
 * What other people are playing, from their com.heorot.activity messages (activityWire.ts). Held in
 * memory only, never written to disk. Each of a person's devices has its own entry; the one received
 * most recently shows, until it expires or that device says the game stopped.
 *
 * The user's own game is here too while they share it (setOwnActivity), so their own profile and
 * member row show what others see.
 */

export interface UserActivity {
    game: ActivityGame;
    startedAt: number;
    expiresAt: number;
    receivedAt: number;
}

/** A device repeating the game it's already showing is ignored if it comes sooner than this. */
export const ACTIVITY_RATE_LIMIT_MS = 30_000;
/** And no device gets more than this many through a minute, whatever it sends. */
const MAX_ACCEPTED_PER_MINUTE = 6;
const PRUNE_INTERVAL_MS = 15_000;

const byUser = new Map<string, Map<string, UserActivity>>();
const acceptedTimes = new Map<string, number[]>();
let own: { userId: string; activity: UserActivity } | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

/** Takes in one message; returns whether anything shown changed. */
export function receiveActivity(userId: string, deviceId: string, incoming: IncomingActivity, now: number): boolean {
    const devices = byUser.get(userId);
    const current = devices?.get(deviceId);
    if (incoming.game === null) {
        if (!devices || !current) {
            return false;
        }
        devices.delete(deviceId);
        if (devices.size === 0) {
            byUser.delete(userId);
        }
        notify();
        return true;
    }

    const key = `${userId}\u0000${deviceId}`;
    const recent = (acceptedTimes.get(key) ?? []).filter((time) => now - time < 60_000);
    const last = recent[recent.length - 1];
    const repeat = current?.game.id === incoming.game.id && last !== undefined && now - last < ACTIVITY_RATE_LIMIT_MS;
    if (repeat || recent.length >= MAX_ACCEPTED_PER_MINUTE) {
        return false;
    }
    recent.push(now);
    acceptedTimes.set(key, recent);

    const next = devices ?? new Map<string, UserActivity>();
    next.set(deviceId, {
        game: incoming.game,
        startedAt: incoming.startedAt,
        expiresAt: incoming.expiresAt,
        receivedAt: now,
    });
    byUser.set(userId, next);
    notify();
    return true;
}

export function getUserActivity(userId: string | null | undefined): UserActivity | null {
    if (!userId) {
        return null;
    }
    if (own?.userId === userId) {
        return own.activity;
    }
    let latest: UserActivity | null = null;
    for (const activity of byUser.get(userId)?.values() ?? []) {
        if (!latest || activity.receivedAt > latest.receivedAt) {
            latest = activity;
        }
    }
    return latest;
}

/** The user's own game while they share it; null when they don't. */
export function setOwnActivity(userId: string, activity: { game: ActivityGame; startedAt: number } | null): void {
    if (!activity) {
        if (own) {
            own = null;
            notify();
        }
        return;
    }
    if (
        own?.userId === userId &&
        own.activity.game.id === activity.game.id &&
        own.activity.game.name === activity.game.name &&
        own.activity.startedAt === activity.startedAt
    ) {
        return;
    }
    own = {
        userId,
        activity: {
            game: activity.game,
            startedAt: activity.startedAt,
            expiresAt: Number.POSITIVE_INFINITY,
            receivedAt: activity.startedAt,
        },
    };
    notify();
}

export function pruneActivity(now: number): void {
    let changed = false;
    for (const [userId, devices] of byUser) {
        for (const [deviceId, activity] of devices) {
            if (activity.expiresAt <= now) {
                devices.delete(deviceId);
                changed = true;
            }
        }
        if (devices.size === 0) {
            byUser.delete(userId);
        }
    }
    for (const [key, times] of acceptedTimes) {
        if (times.every((time) => now - time >= 60_000)) {
            acceptedTimes.delete(key);
        }
    }
    if (changed) {
        notify();
    }
}

export function clearActivity(): void {
    const hadAny = byUser.size > 0 || own !== null;
    byUser.clear();
    acceptedTimes.clear();
    own = null;
    if (hadAny) {
        notify();
    }
}

export function subscribeActivity(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Whether we share a room with someone. People only send their activity to their DM partners and to
 * members of spaces, so those are loaded if the members we already know don't settle it (members load
 * lazily).
 */
async function sharesRoomWith(client: MatrixClient, userId: string): Promise<boolean> {
    const joined = client.getRooms().filter((room) => room.getMyMembership() === KnownMembership.Join);
    const isJoined = (room: Room): boolean => room.getMember(userId)?.membership === KnownMembership.Join;
    if (joined.some(isJoined)) {
        return true;
    }
    const directRoomIds = getDirectRoomIds(client);
    for (const room of joined) {
        if (room.isSpaceRoom() || directRoomIds.has(room.roomId) || room.getJoinedMemberCount() <= 2) {
            await room.loadMembersIfNeeded();
            if (isJoined(room)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Listens for other people's activity messages until the returned function is called, which also
 * forgets everything received. Only encrypted messages count: one sent in the clear could come from
 * anyone. So does only someone we share a room with and haven't blocked.
 */
export function startActivityReceiver(client: MatrixClient): () => void {
    let queue: Promise<void> = Promise.resolve();
    const onMessage = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
        if (message.type !== ACTIVITY_EVENT || !encryptionInfo) {
            return;
        }
        const sender = message.sender;
        if (!sender || sender === client.getUserId() || encryptionInfo.sender !== sender) {
            return;
        }
        const deviceId = encryptionInfo.senderDevice ?? contentDeviceId(message.content) ?? "";
        const content = message.content;
        // One at a time, so a "stopped" can't overtake the "playing" before it.
        queue = queue
            .then(async () => {
                if (client.isUserIgnored(sender) || !(await sharesRoomWith(client, sender))) {
                    return;
                }
                const now = Date.now();
                const incoming = parseIncomingActivity(content, now);
                if (incoming) {
                    receiveActivity(sender, deviceId, incoming, now);
                }
            })
            .catch(() => undefined);
    };

    client.on(ClientEvent.ReceivedToDeviceMessage, onMessage);
    const timer = setInterval(() => pruneActivity(Date.now()), PRUNE_INTERVAL_MS);
    return () => {
        client.removeListener(ClientEvent.ReceivedToDeviceMessage, onMessage);
        clearInterval(timer);
        clearActivity();
    };
}

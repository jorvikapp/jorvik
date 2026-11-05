import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import { getRoomNotificationMode, RoomNotificationMode, setRoomNotificationMode } from "../adapters/roomNotificationAdapter";
import { powerLevelOf } from "./userMenus";

/** What the user-menu items do; each throws with a reason the menu can show. */

export const FAVOURITE_TAG = "m.favourite";

export async function copyUserId(userId: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
        throw new Error("Copying isn't available here.");
    }
    await navigator.clipboard.writeText(userId);
}

export function isRoomMuted(client: MatrixClient, roomId: string): boolean {
    return getRoomNotificationMode(client, roomId) === RoomNotificationMode.Mute;
}

/** Mutes the conversation, or unmutes it back to the default; returns whether it's muted now. */
export async function toggleRoomMute(client: MatrixClient, roomId: string): Promise<boolean> {
    const muted = isRoomMuted(client, roomId);
    await setRoomNotificationMode(client, roomId, muted ? RoomNotificationMode.Default : RoomNotificationMode.Mute);
    return !muted;
}

export function isFavourite(room: Room): boolean {
    return Boolean(room.tags?.[FAVOURITE_TAG]);
}

/** Pins the conversation to the top of the list, or unpins it; returns whether it's a favourite now. */
export async function toggleFavourite(client: MatrixClient, room: Room): Promise<boolean> {
    if (isFavourite(room)) {
        await client.deleteRoomTag(room.roomId, FAVOURITE_TAG);
        return false;
    }
    await client.setRoomTag(room.roomId, FAVOURITE_TAG, {});
    return true;
}

/** Favourites first, each group keeping its order (most recent first). */
export function favouritesFirst(rooms: Room[]): Room[] {
    return [...rooms.filter(isFavourite), ...rooms.filter((room) => !isFavourite(room))];
}

/** Blocking is the ignore list: the server stops sending their messages and invites; they aren't told. */
export async function blockUser(client: MatrixClient, userId: string): Promise<void> {
    const current = client.getIgnoredUsers();
    if (current.includes(userId)) {
        return;
    }
    await client.setIgnoredUsers([...current, userId]);
}

export async function closeConversation(client: MatrixClient, roomId: string): Promise<void> {
    await client.leave(roomId);
}

/** Their rank is the same as yours or higher: Matrix lets nobody remove or ban them, so it isn't tried. */
export class OutrankedError extends Error {}

export interface ScopeResult {
    /** Rooms it worked in, the Space or room itself included. */
    done: number;
    /** Channels it didn't work in, after it worked in the Space. */
    failed: number;
}

const PRESENT = new Set(["join", "invite", "knock"]);

/**
 * Removes or bans someone from a Space: the Space itself first, then its channels (`scope[0]` is the Space, or
 * the room when there's no Space). The Space comes first, and if it fails nothing else is tried: no rank there,
 * or theirs is as high as yours. A channel that fails doesn't stop the rest. Banning covers channels they aren't
 * in too, so they can't join them later; removing only touches the ones they're in.
 */
async function actOnScope(
    client: MatrixClient,
    scope: Room[],
    userId: string,
    ownUserId: string,
    action: "kick" | "ban",
    reason?: string,
): Promise<ScopeResult> {
    const [main, ...rest] = scope;
    if (!main) {
        throw new Error("There's nowhere to remove them from.");
    }
    if (powerLevelOf(main, userId) >= powerLevelOf(main, ownUserId)) {
        throw new OutrankedError("Their rank is the same as yours or higher, so you can't do that.");
    }
    const act = (room: Room): Promise<unknown> =>
        action === "kick" ? client.kick(room.roomId, userId, reason) : client.ban(room.roomId, userId, reason);
    await act(main);
    let done = 1;
    let failed = 0;
    for (const room of rest) {
        const membership = room.getMember(userId)?.membership;
        if (action === "kick" && !PRESENT.has(membership ?? "")) {
            continue;
        }
        if (action === "ban" && membership === "ban") {
            continue;
        }
        const ownLevel = powerLevelOf(room, ownUserId);
        if (!room.currentState.hasSufficientPowerLevelFor(action, ownLevel) || powerLevelOf(room, userId) >= ownLevel) {
            failed += 1;
            continue;
        }
        try {
            await act(room);
            done += 1;
        } catch {
            failed += 1;
        }
    }
    return { done, failed };
}

export function removeFromScope(client: MatrixClient, scope: Room[], userId: string, ownUserId: string, reason?: string): Promise<ScopeResult> {
    return actOnScope(client, scope, userId, ownUserId, "kick", reason);
}

export function banFromScope(client: MatrixClient, scope: Room[], userId: string, ownUserId: string, reason?: string): Promise<ScopeResult> {
    return actOnScope(client, scope, userId, ownUserId, "ban", reason);
}

/** What went wrong, in words: the server's own explanation when it gave one, never "MatrixError: [403] ...". */
export function describeMenuError(error: unknown, fallback: string): string {
    if (error instanceof OutrankedError) {
        return error.message;
    }
    const serverText = (error as { data?: { error?: unknown } } | null)?.data?.error;
    if (typeof serverText === "string" && serverText.trim()) {
        return `${fallback} ${serverText.trim()}`;
    }
    if (error instanceof Error && error.message && !/^MatrixError|^\[?\d{3}\]?/.test(error.message)) {
        return error.message;
    }
    return fallback;
}

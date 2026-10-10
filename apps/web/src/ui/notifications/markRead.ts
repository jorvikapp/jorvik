import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";

import { getServerUnreadCount, hasUnreadActivity } from "./roomUnread";

/**
 * The newest event in a room's live timeline that has reached the server, of any kind.
 * Reading up to it covers everything: an event Jorvik doesn't show (a sticker, a poll, a
 * call) still makes the room unread, and marking only shown messages would never clear it.
 */
export function latestMarkableEvent(room: Room): MatrixEvent | null {
    const events = room.getLiveTimeline()?.getEvents() ?? room.timeline;
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        const eventId = event.getId();
        // Our own unsent messages have local ids and a status until the server has them.
        if (eventId && !eventId.startsWith("~") && !event.status) {
            return event;
        }
    }
    return null;
}

/**
 * Marks each room read up to its newest event, with the read marker and a receipt that
 * isn't tied to a thread, so threads clear too. Rooms with nothing new are left alone, and
 * one that fails doesn't stop the rest.
 */
export async function markRoomsRead(
    client: MatrixClient,
    rooms: readonly Room[],
): Promise<{ marked: number; failed: number }> {
    const ownUserId = client.getUserId();
    let marked = 0;
    let failed = 0;
    if (!ownUserId) {
        return { marked, failed };
    }
    for (const room of rooms) {
        if (!hasUnreadActivity(room, ownUserId) && getServerUnreadCount(room) === 0) {
            continue;
        }
        const latest = latestMarkableEvent(room);
        const latestId = latest?.getId();
        if (!latest || !latestId) {
            continue;
        }
        try {
            await client.setRoomReadMarkers(room.roomId, latestId, latest);
            marked += 1;
        } catch {
            failed += 1;
        }
    }
    return { marked, failed };
}

import { EventType, NotificationCountType, RelationType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

/** What the server counts as waiting for you in a room: notifying messages, or only mentions. */
export function getServerUnreadCount(room: Room, type: NotificationCountType = NotificationCountType.Total): number {
    const getUnreadNotificationCount = (room as Room & {
        getUnreadNotificationCount?: (type?: NotificationCountType) => number;
    }).getUnreadNotificationCount;

    if (!getUnreadNotificationCount) {
        return 0;
    }

    try {
        return getUnreadNotificationCount.call(room, type) ?? 0;
    } catch {
        return 0;
    }
}

// Only what Jorvik shows as a message lights a room up. Anything else (a reaction, an edit,
// a call being answered or hung up) can't be seen, so a dot for it could never be read away.
// A missed call still does: its ring is an ordinary message.
function eventTriggersUnread(event: MatrixEvent, ownUserId: string): boolean {
    if (event.getSender() === ownUserId || event.isRedacted()) {
        return false;
    }

    switch (event.getType()) {
        case EventType.RoomMessage:
            return event.getRelation()?.rel_type !== RelationType.Replace;
        case EventType.Sticker:
        // Not decrypted yet, and most likely a message.
        case EventType.RoomMessageEncrypted:
            return true;
        default:
            return false;
    }
}

/** Whether someone else wrote since you last read the room, notifying or not. */
export function hasUnreadActivity(room: Room, ownUserId: string): boolean {
    const events = room.getLiveTimeline()?.getEvents() ?? room.timeline;
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        const eventId = event.getId();
        if (!eventId) {
            continue;
        }

        if (!eventTriggersUnread(event, ownUserId)) {
            continue;
        }

        return !room.hasUserReadEvent(ownUserId, eventId);
    }

    return false;
}

export interface UnreadSummary {
    // Something new to read in a room that isn't muted.
    unread: boolean;
    // The number on the red badge.
    count: number;
}

/**
 * What a whole space, or all your DMs, has waiting, for its icon in the rail.
 * In a space only mentions are counted, since each channel shows its own
 * number; in DMs every message counts, as each one is written to you.
 */
export function summarizeUnread(
    rooms: readonly Room[],
    ownUserId: string,
    isMuted: (room: Room) => boolean,
    countEveryMessage: boolean,
): UnreadSummary {
    let unread = false;
    let count = 0;
    for (const room of rooms) {
        const total = getServerUnreadCount(room);
        count += countEveryMessage ? total : getServerUnreadCount(room, NotificationCountType.Highlight);
        if (!unread && !isMuted(room) && (total > 0 || hasUnreadActivity(room, ownUserId))) {
            unread = true;
        }
    }
    return { unread, count };
}

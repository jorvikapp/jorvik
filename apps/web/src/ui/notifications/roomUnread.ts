import { EventType, M_BEACON, NotificationCountType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

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

function eventTriggersUnread(event: MatrixEvent, ownUserId: string): boolean {
    if (event.getSender() === ownUserId) {
        return false;
    }

    switch (event.getType()) {
        case EventType.RoomMember:
        case EventType.RoomThirdPartyInvite:
        case EventType.CallAnswer:
        case EventType.CallHangup:
        case EventType.RoomCanonicalAlias:
        case EventType.RoomServerAcl:
        case M_BEACON.name:
        case M_BEACON.altName:
            return false;
    }

    return !event.isRedacted();
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

import { EventType, ReceiptType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

/**
 * Every event the user has said they read up to: their read receipts, public
 * and private, and the fully-read marker. Clients differ in which of these
 * they move, so the latest one that is loaded is where reading stopped.
 */
export function readUpToEventIds(room: Room, userId: string): string[] {
    const ids = new Set<string>();
    const fullyRead = room.getAccountData(EventType.FullyRead)?.getContent<{ event_id?: unknown }>().event_id;
    if (typeof fullyRead === "string" && fullyRead.length > 0) {
        ids.add(fullyRead);
    }
    for (const receiptType of [ReceiptType.Read, ReceiptType.ReadPrivate]) {
        const eventId = room.getReadReceiptForUserId(userId, false, receiptType)?.eventId;
        if (eventId) {
            ids.add(eventId);
        }
    }
    return [...ids];
}

/**
 * Anything in the timeline that is, or may turn out to be, a message: an
 * encrypted event shows its type only once it is decrypted.
 */
export function mayBeMessage(event: MatrixEvent): boolean {
    if (event.isRedacted()) {
        return false;
    }
    const type = event.getType();
    return type === EventType.RoomMessage || type === EventType.RoomMessageEncrypted || type === EventType.Sticker;
}

export interface NewMessagesPosition {
    /** The first message from someone else after where reading stopped, once that point is loaded. */
    firstNewEventId: string | null;
    /** Messages from others after where reading stopped, of those loaded. */
    count: number;
    /** Whether where reading stopped is loaded; if not, every loaded message is new and count is a minimum. */
    readPositionLoaded: boolean;
}

/**
 * Where the line for new messages goes among `messages`, given the room's
 * whole loaded timeline (the read position can be any event, not only a
 * message) and the event ids it was read up to.
 */
export function locateNewMessages(
    timeline: readonly MatrixEvent[],
    messages: readonly MatrixEvent[],
    readUpTo: readonly string[],
    ownUserId: string,
): NewMessagesPosition {
    const order = new Map<string, number>();
    timeline.forEach((event, index) => {
        const id = event.getId();
        if (id) {
            order.set(id, index);
        }
    });

    let readIndex = -1;
    for (const id of readUpTo) {
        const index = order.get(id);
        if (index !== undefined && index > readIndex) {
            readIndex = index;
        }
    }
    const readPositionLoaded = readIndex >= 0;

    let firstNewEventId: string | null = null;
    let count = 0;
    for (const message of messages) {
        if (message.getSender() === ownUserId) {
            continue;
        }
        const id = message.getId();
        const index = id ? order.get(id) : undefined;
        // Not in the timeline: our own unsent messages, which are skipped above anyway.
        if (id === undefined || index === undefined || index <= readIndex) {
            continue;
        }
        count += 1;
        if (readPositionLoaded && firstNewEventId === null) {
            firstNewEventId = id;
        }
    }

    return { firstNewEventId, count, readPositionLoaded };
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "14:02" today, "yesterday at 14:02", otherwise "Oct 3 at 14:02", in the user's locale. */
export function formatSince(timestamp: number, now: Date = new Date()): string {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isSameDay(date, now)) {
        return time;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(date, yesterday)) {
        return `yesterday at ${time}`;
    }
    const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${day} at ${time}`;
}

/**
 * The text of the bar that jumps to the line. Without the read position
 * loaded only a minimum is known, and no time.
 */
export function newMessagesLabel(count: number, sinceTimestamp: number | null, now: Date = new Date()): string {
    if (sinceTimestamp === null) {
        return `${count}+ new messages`;
    }
    const noun = count === 1 ? "message" : "messages";
    return `${count} new ${noun} since ${formatSince(sinceTimestamp, now)}`;
}

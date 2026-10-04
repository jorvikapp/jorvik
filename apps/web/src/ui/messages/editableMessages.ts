import { EventType, MsgType, RelationType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

/** Whether you can edit a message: your own text message, not deleted. */
export function canEditMessage(event: MatrixEvent, ownUserId: string | null): boolean {
    const content = event.getContent() as { msgtype?: unknown };
    return (
        Boolean(ownUserId) &&
        event.getSender() === ownUserId &&
        !event.isRedacted() &&
        event.getType() === EventType.RoomMessage &&
        content.msgtype === MsgType.Text
    );
}

/**
 * Your most recent message in the room that you can edit, for the Up arrow in
 * an empty message box. Edits themselves are skipped, and so are messages still
 * on their way, which have no ID on the server to edit yet.
 */
export function findLastEditableMessage(room: Room, ownUserId: string | null): MatrixEvent | null {
    const events = room.getLiveTimeline().getEvents();
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.isRelation(RelationType.Replace) || !event.getId()?.startsWith("$")) {
            continue;
        }
        if (canEditMessage(event, ownUserId)) {
            return event;
        }
    }
    return null;
}

import { EventType, NotificationCountType, RelationType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { messagePreviewText } from "../formatting/messagePreviewText";
import { getServerUnreadCount } from "./roomUnread";

export type InboxInviteKind = "space" | "direct" | "room";

export interface InboxInvite {
    roomId: string;
    kind: InboxInviteKind;
    inviterId: string | null;
    ts: number;
}

export interface InboxMention {
    roomId: string;
    eventId: string;
    senderId: string;
    body: string;
    ts: number;
    unread: boolean;
}

/** Invites waiting for an answer, newest first. */
export function collectInvites(
    rooms: readonly Room[],
    ownUserId: string,
    isDirect: (room: Room) => boolean,
): InboxInvite[] {
    const invites: InboxInvite[] = [];
    for (const room of rooms) {
        if (room.getMyMembership() !== "invite") {
            continue;
        }
        const inviteEvent = room.currentState.getStateEvents(EventType.RoomMember, ownUserId);
        invites.push({
            roomId: room.roomId,
            kind: room.isSpaceRoom() ? "space" : isDirect(room) ? "direct" : "room",
            inviterId: inviteEvent?.getSender() ?? room.getDMInviter() ?? null,
            ts: inviteEvent?.getTs() ?? 0,
        });
    }
    return invites.sort((a, b) => b.ts - a.ts);
}

function isMentionCandidate(event: MatrixEvent, ownUserId: string): boolean {
    if (event.getSender() === ownUserId || event.isRedacted() || event.isDecryptionFailure()) {
        return false;
    }
    if (event.getType() !== EventType.RoomMessage && event.getType() !== EventType.Sticker) {
        return false;
    }
    // An edit repeats a message that was already counted.
    return event.getRelation()?.rel_type !== RelationType.Replace;
}

function highlights(client: MatrixClient, event: MatrixEvent): boolean {
    // The SDK works these out again once an encrypted message is decrypted, so the cached
    // answer is current.
    const actions = client.getPushActionsForEvent(event);
    return actions?.tweaks?.highlight === true;
}

/**
 * Messages that mention you in what each room has loaded, newest first. The server can't see
 * inside encrypted messages, so it can't list these itself; the push rules are run here instead.
 */
export function collectMentions(
    client: MatrixClient,
    rooms: readonly Room[],
    ownUserId: string,
    limit = 50,
): InboxMention[] {
    const mentions: InboxMention[] = [];
    for (const room of rooms) {
        if (room.getMyMembership() !== "join" || room.isSpaceRoom()) {
            continue;
        }
        for (const event of room.getLiveTimeline().getEvents()) {
            const eventId = event.getId();
            if (!eventId || !isMentionCandidate(event, ownUserId) || !highlights(client, event)) {
                continue;
            }
            mentions.push({
                roomId: room.roomId,
                eventId,
                senderId: event.getSender() ?? "",
                body: messagePreviewText(event.getContent()) || "Attachment",
                ts: event.getTs(),
                unread: !room.hasUserReadEvent(ownUserId, eventId),
            });
        }
    }
    return mentions.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** What the Notifications tab's badge counts: invites, and unread mentions across joined rooms. */
export function inboxBadgeCount(rooms: readonly Room[], invites: number): number {
    let mentions = 0;
    for (const room of rooms) {
        if (room.getMyMembership() === "join") {
            mentions += Math.max(0, getServerUnreadCount(room, NotificationCountType.Highlight));
        }
    }
    return invites + mentions;
}

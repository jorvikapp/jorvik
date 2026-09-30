import type { Room } from "matrix-js-sdk/src/matrix";

import { formatUserIdForDisplay } from "../../../core/users/formatUserId";

// A DM with two or fewer participants is one-to-one: its member list would
// only repeat the two of you, so the other person's profile stands in for it.
// That includes a DM the other person has since left. Group DMs of three or
// more keep the list. The count comes from the room summary, which stays
// accurate with lazy-loaded members; the caller decides whether it is a DM.
export function getOneToOnePartnerId(room: Room, ownUserId: string): string | null {
    if (room.getInvitedAndJoinedMemberCount() > 2) {
        return null;
    }

    const current = room
        .getMembers()
        .find((member) => member.userId !== ownUserId && (member.membership === "join" || member.membership === "invite"));
    const partnerId = current?.userId ?? room.guessDMUserId();
    return partnerId && partnerId !== ownUserId ? partnerId : null;
}

/**
 * What a one-to-one DM is called: the other person's own display name, or
 * their account name (@admin) if they haven't set one. Not room.name, which
 * the SDK turns into "Name (@name:server)" when both people share a display
 * name. A DM someone has named keeps its name (null here).
 */
export function getOneToOneDirectName(room: Room, ownUserId: string, localDomain: string | null): string | null {
    const explicitName = room.currentState.getStateEvents("m.room.name", "")?.getContent()?.name;
    if (typeof explicitName === "string" && explicitName.trim().length > 0) {
        return null;
    }

    const partnerId = getOneToOnePartnerId(room, ownUserId);
    if (!partnerId) {
        return null;
    }

    // rawDisplayName falls back to the user ID when no display name is set.
    const memberName = room.getMember(partnerId)?.rawDisplayName;
    const displayName = memberName && memberName !== partnerId ? memberName : room.client.getUser(partnerId)?.displayName;
    return displayName?.trim() || formatUserIdForDisplay(partnerId, localDomain);
}

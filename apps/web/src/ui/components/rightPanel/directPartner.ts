import type { Room } from "matrix-js-sdk/src/matrix";

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

import { useEffect, useMemo, useState } from "react";
import {
    EventType,
    RoomStateEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
    type RoomState,
} from "matrix-js-sdk/src/matrix";

/** Who a room's member list shows: the people in it, and the people invited. */
export function visibleMembers(room: Room): RoomMember[] {
    return room.getMembers().filter((member) => member.membership === "join" || member.membership === "invite");
}

/**
 * A room's member list, kept current. The Room object never changes, so a list worked out once would stay as it
 * was when the panel opened: it's worked out again when someone joins, leaves, is invited, removed or banned, and
 * when ranks change here or in `rankRoom` (the Space, whose ranks the list shows). It also asks the server for the
 * whole list once, because at sign-in the server only sends the members needed to show the messages.
 */
export function useRoomMembers(client: MatrixClient, room: Room, rankRoom: Room | null = null): RoomMember[] {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let alive = true;
        const changed = (): void => {
            if (alive) {
                setVersion((value) => value + 1);
            }
        };
        const onMembers = (_event: MatrixEvent, state: RoomState): void => {
            if (state.roomId === room.roomId) {
                changed();
            }
        };
        const onState = (event: MatrixEvent, state: RoomState): void => {
            if (event.getType() === EventType.RoomPowerLevels && (state.roomId === room.roomId || state.roomId === rankRoom?.roomId)) {
                changed();
            }
        };
        client.on(RoomStateEvent.Members, onMembers);
        client.on(RoomStateEvent.Events, onState);
        room.loadMembersIfNeeded().then(changed, () => undefined);
        return () => {
            alive = false;
            client.removeListener(RoomStateEvent.Members, onMembers);
            client.removeListener(RoomStateEvent.Events, onState);
        };
    }, [client, room, rankRoom]);
    // `version` is how a change inside the same Room object gets here.
    return useMemo(() => visibleMembers(room), [room, version]);
}

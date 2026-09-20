import type { HierarchyRoom } from "matrix-js-sdk/src/matrix";

export interface StateSnapshotLikeEvent {
    type?: unknown;
    state_key?: unknown;
    content?: unknown;
}

/**
 * The parent's own m.space.child events, taken from the hierarchy response we already
 * fetched. Synapse builds this from the same current state that GET /rooms/{id}/state
 * serves, without truncation, so it replaces downloading the space's entire state.
 */
export function rootChildrenState(
    hierarchyRooms: readonly HierarchyRoom[],
    spaceRoomId: string,
): StateSnapshotLikeEvent[] {
    const root = hierarchyRooms.find((room) => room.room_id === spaceRoomId);
    return (root?.children_state ?? []) as StateSnapshotLikeEvent[];
}

interface LocalRoomLike {
    getMyMembership: () => string;
}

export interface VoiceHintSelection {
    /** Voice channels recognised from state we already hold locally. */
    detected: string[];
    /** Rooms worth a state request: joined, but not recognised locally. */
    toProbe: string[];
}

/**
 * Decides which child rooms are worth asking the server about.
 *
 * Previously every unrecognised child was probed with GET /rooms/{id}/state, which a
 * non-member cannot read: of roughly 206 such probes measured against
 * #community:matrix.org, none succeeded. Local state is used wherever it exists --
 * which covers a publicly readable or invited room whose state we happen to hold -- and
 * only joined rooms are probed, since only those can answer.
 */
export function selectVoiceHintCandidates<TRoom extends LocalRoomLike>(options: {
    childRoomIds: readonly string[];
    getRoom: (roomId: string) => TRoom | null;
    isVoiceChannel: (room: TRoom | null) => boolean;
}): VoiceHintSelection {
    const detected: string[] = [];
    const toProbe: string[] = [];
    const seen = new Set<string>();

    for (const roomId of options.childRoomIds) {
        if (seen.has(roomId)) {
            continue;
        }
        seen.add(roomId);

        const room = options.getRoom(roomId);
        if (!room) {
            // Nothing held locally and no membership: a request would be refused.
            continue;
        }

        if (options.isVoiceChannel(room)) {
            detected.push(roomId);
            continue;
        }

        if (room.getMyMembership() === "join") {
            // Joined but not recognised: local state may still be filling in.
            toProbe.push(roomId);
        }
    }

    return { detected, toProbe };
}

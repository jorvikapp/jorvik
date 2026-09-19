import { JoinRule, RoomType, type HierarchyRoom } from "matrix-js-sdk/src/matrix";

/** What a user can actually do with a child room, given its join rule. */
export type SpaceChildAffordance = "join" | "request" | "invite_only";

export interface SpaceChildRoom {
    roomId: string;
    name: string;
    topic?: string;
    avatarMxc: string | null;
    memberCount: number;
    joinRule: string;
    affordance: SpaceChildAffordance;
    viaServers: string[];
}

export interface SpaceChildSpace {
    roomId: string;
    name: string;
    avatarMxc: string | null;
    memberCount: number;
    viaServers: string[];
}

export interface SpaceChildren {
    rooms: SpaceChildRoom[];
    spaces: SpaceChildSpace[];
}

export function normaliseJoinRule(value: unknown): string {
    return typeof value === "string" && value.length > 0 ? value.toLowerCase() : "unknown";
}

export function isSpaceEntry(room: Pick<HierarchyRoom, "room_type">): boolean {
    return room.room_type === RoomType.Space || room.room_type === "m.space";
}

/**
 * Restricted rooms are the normal pattern for channels inside a space: joinable
 * because you belong to an allowed parent. Knock rooms take a request rather than a
 * join. Anything else needs an invite, so it is listed but not offered as joinable.
 */
export function affordanceForJoinRule(joinRule: string): SpaceChildAffordance {
    switch (normaliseJoinRule(joinRule)) {
        case JoinRule.Public:
        case JoinRule.Restricted:
            return "join";
        case JoinRule.Knock:
            return "request";
        default:
            return "invite_only";
    }
}

export function hierarchyRoomName(room: Pick<HierarchyRoom, "name" | "canonical_alias" | "room_id">): string {
    return room.name || room.canonical_alias || room.room_id;
}

interface PartitionOptions {
    /**
     * Room ids already present elsewhere in the tree. A space may legally list itself
     * or an ancestor as a child, so without this a naive expansion recurses forever.
     */
    excludeRoomIds?: ReadonlySet<string>;
    viaServersByRoomId?: ReadonlyMap<string, string[]>;
}

export function partitionSpaceChildren(
    spaceRoomId: string,
    hierarchyRooms: readonly HierarchyRoom[],
    options: PartitionOptions = {},
): SpaceChildren {
    const exclude = options.excludeRoomIds ?? new Set<string>();
    const viaByRoomId = options.viaServersByRoomId ?? new Map<string, string[]>();
    const seen = new Set<string>([spaceRoomId]);

    const rooms: SpaceChildRoom[] = [];
    const spaces: SpaceChildSpace[] = [];

    for (const room of hierarchyRooms) {
        if (seen.has(room.room_id) || exclude.has(room.room_id)) {
            continue;
        }
        seen.add(room.room_id);

        const viaServers = (viaByRoomId.get(room.room_id) ?? []).filter((server) => server.length > 0);

        if (isSpaceEntry(room)) {
            spaces.push({
                roomId: room.room_id,
                name: hierarchyRoomName(room),
                avatarMxc: room.avatar_url ?? null,
                memberCount: room.num_joined_members,
                viaServers,
            });
            continue;
        }

        const joinRule = normaliseJoinRule(room.join_rule);
        rooms.push({
            roomId: room.room_id,
            name: hierarchyRoomName(room),
            topic: room.topic,
            avatarMxc: room.avatar_url ?? null,
            memberCount: room.num_joined_members,
            joinRule,
            affordance: affordanceForJoinRule(joinRule),
            viaServers,
        });
    }

    return { rooms, spaces };
}

/**
 * `via` servers for each child, read from the parent's children_state. Needed to join a
 * room on a server we have no other route to.
 */
export function readViaServers(hierarchyRooms: readonly HierarchyRoom[]): Map<string, string[]> {
    const viaByRoomId = new Map<string, string[]>();

    for (const room of hierarchyRooms) {
        for (const relation of room.children_state ?? []) {
            const childId = typeof relation.state_key === "string" ? relation.state_key : "";
            if (childId.length === 0 || viaByRoomId.has(childId)) {
                continue;
            }

            const via = (relation.content as { via?: unknown } | undefined)?.via;
            if (Array.isArray(via)) {
                viaByRoomId.set(
                    childId,
                    via.filter((server): server is string => typeof server === "string" && server.length > 0),
                );
            }
        }
    }

    return viaByRoomId;
}

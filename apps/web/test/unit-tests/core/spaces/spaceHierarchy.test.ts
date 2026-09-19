import type { HierarchyRoom } from "matrix-js-sdk/src/matrix";
import { describe, expect, it } from "vitest";

import {
    affordanceForJoinRule,
    normaliseJoinRule,
    partitionSpaceChildren,
    readViaServers,
} from "../../../../src/core/spaces/spaceHierarchy";

function room(overrides: Partial<HierarchyRoom> & { room_id: string }): HierarchyRoom {
    return {
        num_joined_members: 1,
        world_readable: true,
        guest_can_join: false,
        children_state: [],
        ...overrides,
    } as HierarchyRoom;
}

describe("affordanceForJoinRule", () => {
    it("offers a join for public and restricted rooms", () => {
        expect(affordanceForJoinRule("public")).toBe("join");
        expect(affordanceForJoinRule("restricted")).toBe("join");
    });

    it("offers a request for knock rooms rather than treating them as joinable", () => {
        expect(affordanceForJoinRule("knock")).toBe("request");
    });

    it("treats invite-only and unknown rules as needing an invite", () => {
        expect(affordanceForJoinRule("invite")).toBe("invite_only");
        expect(affordanceForJoinRule("private")).toBe("invite_only");
        expect(affordanceForJoinRule("something_new")).toBe("invite_only");
        expect(affordanceForJoinRule("")).toBe("invite_only");
    });

    it("is case insensitive", () => {
        expect(affordanceForJoinRule("ReStRiCtEd")).toBe("join");
        expect(normaliseJoinRule(undefined)).toBe("unknown");
    });
});

describe("partitionSpaceChildren", () => {
    const parent = "!parent:example.org";

    it("separates subspaces from rooms and keeps order", () => {
        const result = partitionSpaceChildren(parent, [
            room({ room_id: parent, room_type: "m.space" }),
            room({ room_id: "!a:example.org", name: "Alpha", join_rule: "public" }),
            room({ room_id: "!sub:example.org", name: "Sub", room_type: "m.space" }),
            room({ room_id: "!b:example.org", name: "Beta", join_rule: "restricted" }),
        ]);

        expect(result.rooms.map((entry) => entry.name)).toEqual(["Alpha", "Beta"]);
        expect(result.spaces.map((entry) => entry.name)).toEqual(["Sub"]);
    });

    it("excludes the space itself", () => {
        const result = partitionSpaceChildren(parent, [room({ room_id: parent, room_type: "m.space" })]);
        expect(result.rooms).toHaveLength(0);
        expect(result.spaces).toHaveLength(0);
    });

    it("keeps restricted and knock rooms with the right affordance", () => {
        const result = partitionSpaceChildren(parent, [
            room({ room_id: "!r:example.org", join_rule: "restricted" }),
            room({ room_id: "!k:example.org", join_rule: "knock" }),
            room({ room_id: "!i:example.org", join_rule: "invite" }),
        ]);

        expect(result.rooms.map((entry) => entry.affordance)).toEqual(["join", "request", "invite_only"]);
    });

    it("drops duplicates within one response", () => {
        const result = partitionSpaceChildren(parent, [
            room({ room_id: "!a:example.org", join_rule: "public" }),
            room({ room_id: "!a:example.org", join_rule: "public" }),
        ]);
        expect(result.rooms).toHaveLength(1);
    });

    it("skips ids already seen elsewhere in the tree, so a cycle cannot recurse", () => {
        const result = partitionSpaceChildren(parent, [
            room({ room_id: "!ancestor:example.org", room_type: "m.space" }),
            room({ room_id: "!fresh:example.org", join_rule: "public" }),
        ], { excludeRoomIds: new Set(["!ancestor:example.org"]) });

        expect(result.spaces).toHaveLength(0);
        expect(result.rooms.map((entry) => entry.roomId)).toEqual(["!fresh:example.org"]);
    });

    it("attaches via servers from the parent's children_state", () => {
        const rooms = [
            room({
                room_id: parent,
                room_type: "m.space",
                children_state: [
                    {
                        state_key: "!a:example.org",
                        content: { via: ["example.org", ""] },
                        type: "m.space.child",
                        sender: "@x:example.org",
                        origin_server_ts: 0,
                    },
                ],
            } as Partial<HierarchyRoom> & { room_id: string }),
            room({ room_id: "!a:example.org", join_rule: "public" }),
        ];

        const result = partitionSpaceChildren(parent, rooms, { viaServersByRoomId: readViaServers(rooms) });
        expect(result.rooms[0].viaServers).toEqual(["example.org"]);
    });
});

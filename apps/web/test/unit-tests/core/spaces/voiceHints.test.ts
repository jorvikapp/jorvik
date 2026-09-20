import type { HierarchyRoom } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

import { rootChildrenState, selectVoiceHintCandidates } from "../../../../src/core/spaces/voiceHints";

interface FakeRoom {
    membership: string;
    voice: boolean;
    getMyMembership: () => string;
}

function room(membership: string, voice = false): FakeRoom {
    return { membership, voice, getMyMembership: () => membership };
}

function select(rooms: Record<string, FakeRoom | null>, ids = Object.keys(rooms)) {
    const getRoom = vi.fn((roomId: string) => rooms[roomId] ?? null);
    const isVoiceChannel = vi.fn((candidate: FakeRoom | null) => candidate?.voice === true);
    const selection = selectVoiceHintCandidates({ childRoomIds: ids, getRoom, isVoiceChannel });
    return { selection, getRoom, isVoiceChannel };
}

describe("selectVoiceHintCandidates", () => {
    it("never probes a room we hold nothing for", () => {
        const { selection } = select({ "!unknown:x": null });
        expect(selection.detected).toEqual([]);
        expect(selection.toProbe).toEqual([]);
    });

    it("never probes a room we are not joined to", () => {
        const { selection } = select({ "!invited:x": room("invite"), "!left:x": room("leave") });
        expect(selection.toProbe).toEqual([]);
    });

    it("detects a joined voice channel from local state, with no probe", () => {
        const { selection } = select({ "!voice:x": room("join", true) });
        expect(selection.detected).toEqual(["!voice:x"]);
        expect(selection.toProbe).toEqual([]);
    });

    it("detects a publicly readable voice room we hold state for even when not joined", () => {
        const { selection } = select({ "!peeked:x": room("leave", true) });
        expect(selection.detected).toEqual(["!peeked:x"]);
        expect(selection.toProbe).toEqual([]);
    });

    it("probes only a joined room it could not recognise locally", () => {
        const { selection } = select({
            "!joined-plain:x": room("join"),
            "!joined-voice:x": room("join", true),
            "!invited:x": room("invite"),
            "!unknown:x": null,
        });
        expect(selection.detected).toEqual(["!joined-voice:x"]);
        expect(selection.toProbe).toEqual(["!joined-plain:x"]);
    });

    it("keeps a large unjoined space free of probes entirely", () => {
        const rooms: Record<string, FakeRoom | null> = {};
        for (let index = 0; index < 95; index++) {
            rooms[`!child${index}:x`] = null;
        }
        const { selection, isVoiceChannel } = select(rooms);
        expect(selection.toProbe).toHaveLength(0);
        expect(isVoiceChannel).not.toHaveBeenCalled();
    });

    it("ignores duplicate ids", () => {
        const rooms = { "!a:x": room("join") };
        const { selection, getRoom } = select(rooms, ["!a:x", "!a:x", "!a:x"]);
        expect(selection.toProbe).toEqual(["!a:x"]);
        expect(getRoom).toHaveBeenCalledTimes(1);
    });
});

describe("rootChildrenState", () => {
    const space = "!space:x";

    function hierarchy(): HierarchyRoom[] {
        return [
            {
                room_id: space,
                room_type: "m.space",
                num_joined_members: 1,
                world_readable: true,
                guest_can_join: false,
                children_state: [
                    { type: "m.space.child", state_key: "!a:x", content: { via: ["x"], order: "10" } },
                    { type: "m.space.child", state_key: "!b:x", content: { via: ["x"] } },
                ],
            } as unknown as HierarchyRoom,
            { room_id: "!a:x", children_state: [] } as unknown as HierarchyRoom,
        ];
    }

    it("returns the parent's own child events", () => {
        const events = rootChildrenState(hierarchy(), space);
        expect(events).toHaveLength(2);
        expect(events.map((event) => event.state_key)).toEqual(["!a:x", "!b:x"]);
    });

    it("returns nothing when the parent is absent from the response", () => {
        expect(rootChildrenState(hierarchy(), "!missing:x")).toEqual([]);
    });

    it("returns nothing when the parent lists no children", () => {
        expect(rootChildrenState([{ room_id: space } as unknown as HierarchyRoom], space)).toEqual([]);
    });
});

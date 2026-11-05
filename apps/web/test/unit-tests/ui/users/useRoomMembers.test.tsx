import React, { act } from "react";
import { EventEmitter } from "events";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { RoomStateEvent, type MatrixClient, type Room, type RoomMember } from "matrix-js-sdk/src/matrix";

import { useRoomMembers } from "../../../../src/ui/users/useRoomMembers";

const member = (userId: string, membership: string): RoomMember => ({ userId, membership }) as unknown as RoomMember;

function fakeRoom(roomId: string, members: RoomMember[]): Room & { members: RoomMember[]; finishLoading: () => Promise<void> } {
    let finish: (loaded: boolean) => void = () => undefined;
    const loading = new Promise<boolean>((resolve) => {
        finish = resolve;
    });
    const room = {
        roomId,
        members,
        getMembers: () => room.members,
        loadMembersIfNeeded: vi.fn(() => loading),
        finishLoading: async () => {
            finish(true);
            await loading;
        },
    };
    return room as unknown as Room & { members: RoomMember[]; finishLoading: () => Promise<void> };
}

function setup(room: Room, rankRoom: Room | null = null) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const client = new EventEmitter() as unknown as MatrixClient & EventEmitter;
    const seen: RoomMember[][] = [];
    function List(): null {
        seen.push(useRoomMembers(client, room, rankRoom));
        return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<List />));
    const ids = (): string[] => seen[seen.length - 1].map((m) => m.userId);
    return { client, root, seen, ids };
}

describe("a room's member list", () => {
    it("shows the people in it and the people invited, not those who left or were banned", () => {
        const room = fakeRoom("!general", [member("@a:x", "join"), member("@b:x", "invite"), member("@c:x", "leave"), member("@d:x", "ban")]);
        const { ids, root } = setup(room);
        expect(ids()).toEqual(["@a:x", "@b:x"]);
        act(() => root.unmount());
    });

    it("follows people joining and being removed in that room, and not in others", () => {
        const room = fakeRoom("!general", [member("@a:x", "join"), member("@troll:x", "join")]);
        const { client, ids, root } = setup(room);
        room.members = [member("@a:x", "join"), member("@troll:x", "leave"), member("@new:x", "join")];

        act(() => {
            client.emit(RoomStateEvent.Members, {}, { roomId: "!elsewhere" }, null);
        });
        expect(ids()).toEqual(["@a:x", "@troll:x"]);

        act(() => {
            client.emit(RoomStateEvent.Members, {}, { roomId: "!general" }, null);
        });
        expect(ids()).toEqual(["@a:x", "@new:x"]);
        act(() => root.unmount());
    });

    it("asks the server for everyone, and shows them once they arrive", async () => {
        const room = fakeRoom("!general", [member("@talker:x", "join")]);
        const { ids, root } = setup(room);
        expect(room.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
        room.members = [member("@talker:x", "join"), member("@quiet:x", "join")];
        await act(async () => {
            await room.finishLoading();
        });
        expect(ids()).toEqual(["@talker:x", "@quiet:x"]);
        act(() => root.unmount());
    });

    it("works the list out again when ranks change here or in the Space", () => {
        const room = fakeRoom("!general", [member("@a:x", "join")]);
        const space = fakeRoom("!space", []);
        const { client, seen, root } = setup(room, space);
        const ranks = { getType: () => "m.room.power_levels" };
        const topic = { getType: () => "m.room.topic" };

        const before = seen[seen.length - 1];
        act(() => {
            client.emit(RoomStateEvent.Events, topic, { roomId: "!space" }, null);
        });
        expect(seen[seen.length - 1]).toBe(before);
        act(() => {
            client.emit(RoomStateEvent.Events, ranks, { roomId: "!space" }, null);
        });
        const afterSpace = seen[seen.length - 1];
        expect(afterSpace).not.toBe(before);
        act(() => {
            client.emit(RoomStateEvent.Events, ranks, { roomId: "!general" }, null);
        });
        expect(seen[seen.length - 1]).not.toBe(afterSpace);
        act(() => root.unmount());
    });

    it("stops listening once the list is closed", () => {
        const room = fakeRoom("!general", []);
        const { client, root } = setup(room);
        expect(client.listenerCount(RoomStateEvent.Members)).toBe(1);
        act(() => root.unmount());
        expect(client.listenerCount(RoomStateEvent.Members)).toBe(0);
        expect(client.listenerCount(RoomStateEvent.Events)).toBe(0);
    });
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inviteUsersToRoom = vi.fn(async (_client: unknown, roomId: string, userId: string) => ({
    invited: [userId],
    failed: [],
    roomId,
}));
vi.mock("../../../../src/ui/adapters/inviteAdapter", () => ({
    inviteUsersToRoom: (...args: [unknown, string, string]) => inviteUsersToRoom(...args),
}));
vi.mock("../../../../src/ui/adapters/dmAdapter", () => ({ getDirectRoomIds: () => new Set(["!dm:x"]) }));

const { AddToRoomDialog } = await import("../../../../src/ui/components/rooms/AddToRoomDialog");

const THEM = "@them:x";
let container: HTMLDivElement;
let root: Root;

function room(roomId: string, name: string, opts: { space?: boolean; canInvite?: boolean; theirs?: string; children?: string[] } = {}) {
    return {
        roomId,
        name,
        getCanonicalAlias: () => null,
        getMyMembership: () => "join",
        isSpaceRoom: () => opts.space === true,
        canInvite: () => opts.canInvite !== false,
        getMember: (userId: string) => (userId === THEM && opts.theirs ? { membership: opts.theirs } : null),
        currentState: {
            getStateEvents: () => (opts.children ?? []).map((childId) => ({ getStateKey: () => childId })),
        },
    };
}

const ROOMS = [
    room("!space:x", "Test Space", { space: true, children: ["!general:x"] }),
    room("!general:x", "general"),
    room("!mods:x", "mods", { canInvite: false }),
    room("!lounge:x", "lounge", { theirs: "join" }),
    room("!dm:x", "them"),
];
const client = { getUserId: () => "@me:x", getUser: () => ({ displayName: "Them" }), getRooms: () => ROOMS };

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    inviteUsersToRoom.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("AddToRoomDialog", () => {
    it("lists only places you can invite them to, spaces first", () => {
        act(() => root.render(<AddToRoomDialog client={client as never} userId={THEM} onClose={vi.fn()} onInvited={vi.fn()} />));
        const labels = [...document.querySelectorAll(".add-to-room-item")].map((item) => item.textContent);
        expect(labels).toEqual(["Test SpaceSpaceInvite", "# generalTest SpaceInvite"]);
    });

    it("invites and reports it", async () => {
        const onInvited = vi.fn();
        const onClose = vi.fn();
        act(() => root.render(<AddToRoomDialog client={client as never} userId={THEM} onClose={onClose} onInvited={onInvited} />));
        await act(async () => {
            (document.querySelectorAll(".add-to-room-item")[1] as HTMLButtonElement).click();
        });
        expect(inviteUsersToRoom).toHaveBeenCalledWith(client, "!general:x", THEM, "");
        expect(onInvited).toHaveBeenCalledWith("Invited Them to general.");
        expect(onClose).toHaveBeenCalled();
    });

    it("renders nothing while closed", () => {
        act(() => root.render(<AddToRoomDialog client={client as never} userId={null} onClose={vi.fn()} onInvited={vi.fn()} />));
        expect(document.querySelector(".add-to-room-item")).toBeNull();
    });
});

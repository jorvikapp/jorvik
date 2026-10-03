import { describe, expect, it } from "vitest";

import { getOneToOneDirectLabel, getOneToOneDirectName } from "../../../../src/ui/components/rightPanel/directPartner";

const ME = "@xuruh:matrix.jorvik.app";

interface FakeMember { userId: string; membership: string; rawDisplayName: string }

function fakeRoom(members: FakeMember[], opts: { roomName?: string; globalName?: string } = {}) {
    return {
        currentState: {
            getStateEvents: (type: string) => (type === "m.room.name" && opts.roomName ? { getContent: () => ({ name: opts.roomName }) } : null),
        },
        getInvitedAndJoinedMemberCount: () => members.filter((m) => m.membership === "join" || m.membership === "invite").length,
        getMembers: () => members,
        getMember: (userId: string) => members.find((m) => m.userId === userId) ?? null,
        guessDMUserId: () => members.find((m) => m.userId !== ME)?.userId ?? ME,
        client: { getUser: () => (opts.globalName ? { displayName: opts.globalName } : null) },
    } as never;
}

const me: FakeMember = { userId: ME, membership: "join", rawDisplayName: "Xuruh" };

describe("getOneToOneDirectName", () => {
    it("uses the person's own display name, even when it matches yours", () => {
        const room = fakeRoom([me, { userId: "@admin:matrix.jorvik.app", membership: "join", rawDisplayName: "Xuruh" }]);
        expect(getOneToOneDirectName(room, ME, "matrix.jorvik.app")).toBe("Xuruh");
    });

    it("falls back to the account name when no display name is set", () => {
        const room = fakeRoom([me, { userId: "@admin:matrix.jorvik.app", membership: "join", rawDisplayName: "@admin:matrix.jorvik.app" }]);
        expect(getOneToOneDirectName(room, ME, "matrix.jorvik.app")).toBe("@admin");
    });

    it("keeps the full ID for someone on another server without a display name", () => {
        const room = fakeRoom([me, { userId: "@bob:matrix.org", membership: "join", rawDisplayName: "@bob:matrix.org" }]);
        expect(getOneToOneDirectName(room, ME, "matrix.jorvik.app")).toBe("@bob:matrix.org");
    });

    it("leaves named DMs and group DMs to the room's own name", () => {
        const named = fakeRoom([me, { userId: "@admin:matrix.jorvik.app", membership: "join", rawDisplayName: "Xuruh" }], { roomName: "Plans" });
        expect(getOneToOneDirectName(named, ME, "matrix.jorvik.app")).toBeNull();
        const group = fakeRoom([
            me,
            { userId: "@a:matrix.jorvik.app", membership: "join", rawDisplayName: "A" },
            { userId: "@b:matrix.jorvik.app", membership: "join", rawDisplayName: "B" },
        ]);
        expect(getOneToOneDirectName(group, ME, "matrix.jorvik.app")).toBeNull();
    });
});

describe("getOneToOneDirectLabel", () => {
    it("puts the short account name beside a display name, even one you share", () => {
        const room = fakeRoom([me, { userId: "@admin:matrix.jorvik.app", membership: "join", rawDisplayName: "Xuruh" }]);
        expect(getOneToOneDirectLabel(room, ME, "matrix.jorvik.app")).toBe("Xuruh (@admin)");
    });

    it("is just the account name when there is no display name", () => {
        const room = fakeRoom([me, { userId: "@admin:matrix.jorvik.app", membership: "join", rawDisplayName: "@admin:matrix.jorvik.app" }]);
        expect(getOneToOneDirectLabel(room, ME, "matrix.jorvik.app")).toBe("@admin");
    });

    it("keeps the server for someone on another server", () => {
        const room = fakeRoom([me, { userId: "@bob:matrix.org", membership: "join", rawDisplayName: "Bob" }]);
        expect(getOneToOneDirectLabel(room, ME, "matrix.jorvik.app")).toBe("Bob (@bob:matrix.org)");
    });

    it("leaves named DMs to their own name", () => {
        const named = fakeRoom([me, { userId: "@admin:matrix.jorvik.app", membership: "join", rawDisplayName: "Xuruh" }], { roomName: "Plans" });
        expect(getOneToOneDirectLabel(named, ME, "matrix.jorvik.app")).toBeNull();
    });
});

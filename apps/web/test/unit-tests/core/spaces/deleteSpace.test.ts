import { describe, expect, it, vi } from "vitest";

import { deleteSpace, planSpaceDeletion } from "../../../../src/core/spaces/deleteSpace";

const ME = "@me:x";

interface FakeMember { userId: string; membership: string; powerLevel: number }

function fakeRoom(roomId: string, name: string, members: FakeMember[], opts: { children?: string[]; mayClose?: boolean; joined?: boolean } = {}) {
    return {
        roomId,
        name,
        getCanonicalAlias: () => null,
        getMyMembership: () => (opts.joined === false ? "leave" : "join"),
        getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
        getMembers: () => members,
        loadMembersIfNeeded: vi.fn(async () => true),
        currentState: {
            getStateEvents: () =>
                (opts.children ?? []).map((childId) => ({ getContent: () => ({ via: ["x"] }), getStateKey: () => childId })),
            maySendStateEvent: () => opts.mayClose !== false,
            hasSufficientPowerLevelFor: () => opts.mayClose !== false,
        },
    };
}

const members = (extra: FakeMember[] = []): FakeMember[] => [
    { userId: ME, membership: "join", powerLevel: 100 },
    { userId: "@bob:x", membership: "join", powerLevel: 0 },
    { userId: "@invited:x", membership: "invite", powerLevel: 0 },
    { userId: "@gone:x", membership: "leave", powerLevel: 0 },
    ...extra,
];

function makeClient(rooms: ReturnType<typeof fakeRoom>[], kick = vi.fn(async () => ({}))) {
    const calls: string[] = [];
    const record = (label: string) => vi.fn(async (...args: unknown[]) => {
        calls.push(`${label} ${args.filter((arg) => typeof arg === "string").join(" ")}`.trim());
        return {};
    });
    return {
        calls,
        getSafeUserId: () => ME,
        getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
        sendStateEvent: vi.fn(async (roomId: string, type: string, content: Record<string, unknown>, stateKey: string) => {
            calls.push(`state ${roomId} ${type} ${JSON.stringify(content)} ${stateKey}`.trim());
            return {};
        }),
        setRoomDirectoryVisibility: record("directory"),
        kick: vi.fn(async (roomId: string, userId: string, reason?: string) => {
            await kick(roomId, userId, reason);
            calls.push(`kick ${roomId} ${userId}`);
            return {};
        }),
        leave: record("leave"),
        forget: record("forget"),
    };
}

describe("planSpaceDeletion", () => {
    it("lists channels first, the space last, and who cannot be removed", async () => {
        const general = fakeRoom("!general:x", "general", members([{ userId: "@coowner:x", membership: "join", powerLevel: 100 }]));
        const space = fakeRoom("!space:x", "Space", members(), { children: ["!general:x", "!elsewhere:x"] });
        const client = makeClient([general, space]);

        const plan = await planSpaceDeletion(client as never, space as never);
        expect(plan.blockedReason).toBeNull();
        expect(plan.targets.map((target) => target.name)).toEqual(["general", "Space"]);
        expect(plan.targets[0].unremovable).toEqual(["@coowner:x"]);
        expect(plan.targets[1].unremovable).toEqual([]);
        expect(plan.notJoinedChildIds).toEqual(["!elsewhere:x"]);
        expect(general.loadMembersIfNeeded).toHaveBeenCalled();
    });

    it("refuses someone who cannot remove members or change settings", async () => {
        const space = fakeRoom("!space:x", "Space", members(), { mayClose: false });
        const plan = await planSpaceDeletion(makeClient([space]) as never, space as never);
        expect(plan.blockedReason).toMatch(/Only someone/);
        expect(plan.targets).toEqual([]);
    });
});

describe("deleteSpace", () => {
    it("closes, empties and leaves every room, channels before the space", async () => {
        const general = fakeRoom("!general:x", "general", members());
        const space = fakeRoom("!space:x", "Space", members(), { children: ["!general:x"] });
        const client = makeClient([general, space]);
        const plan = await planSpaceDeletion(client as never, space as never);

        const result = await deleteSpace(client as never, space as never, plan, () => undefined);
        expect(result.remaining).toEqual([]);
        expect(client.calls).toEqual([
            'state !general:x m.room.join_rules {"join_rule":"invite"}',
            "directory !general:x private",
            "kick !general:x @bob:x",
            "kick !general:x @invited:x",
            "state !space:x m.space.child {} !general:x",
            "leave !general:x",
            "forget !general:x",
            'state !space:x m.room.join_rules {"join_rule":"invite"}',
            "directory !space:x private",
            "kick !space:x @bob:x",
            "kick !space:x @invited:x",
            "leave !space:x",
            "forget !space:x",
        ]);
    });

    it("waits out rate limits, and reports whoever could not be removed", async () => {
        let limited = true;
        const kick = vi.fn(async (_roomId: string, userId: string) => {
            if (userId === "@bob:x" && limited) {
                limited = false;
                throw Object.assign(new Error("slow down"), { errcode: "M_LIMIT_EXCEEDED", data: { retry_after_ms: 10 } });
            }
            if (userId === "@invited:x") {
                throw Object.assign(new Error("forbidden"), { errcode: "M_FORBIDDEN" });
            }
        });
        const space = fakeRoom("!space:x", "Space", members([{ userId: "@coowner:x", membership: "join", powerLevel: 100 }]));
        const client = makeClient([space], kick);
        const plan = await planSpaceDeletion(client as never, space as never);

        const result = await deleteSpace(client as never, space as never, plan, () => undefined);
        expect(client.calls).toContain("kick !space:x @bob:x");
        expect(kick).toHaveBeenCalledTimes(3);
        expect(result.remaining).toEqual([
            { roomName: "Space", userId: "@invited:x" },
            { roomName: "Space", userId: "@coowner:x" },
        ]);
    });
});

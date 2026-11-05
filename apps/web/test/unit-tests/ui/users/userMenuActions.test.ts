import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

vi.mock("../../../../src/ui/adapters/roomNotificationAdapter", () => ({
    RoomNotificationMode: { Default: "default", AllMessages: "all_messages", MentionsOnly: "mentions_only", Mute: "mute" },
    getRoomNotificationMode: vi.fn(() => "default"),
    setRoomNotificationMode: vi.fn(async () => undefined),
}));

import * as adapter from "../../../../src/ui/adapters/roomNotificationAdapter";
import {
    banFromScope,
    blockUser,
    copyUserId,
    describeMenuError,
    favouritesFirst,
    OutrankedError,
    removeFromScope,
    toggleFavourite,
    toggleRoomMute,
} from "../../../../src/ui/users/userMenuActions";

const ME = "@mod:example.org";
const TARGET = "@troll:example.org";

interface FakeRoomSpec {
    id: string;
    levels?: Record<string, number>;
    memberships?: Record<string, string>;
    needed?: number;
    tags?: Record<string, object>;
}
const fakeRoom = ({ id, levels = {}, memberships = {}, needed = 50, tags = {} }: FakeRoomSpec): Room =>
    ({
        roomId: id,
        tags,
        getMember: (userId: string) =>
            userId in memberships || userId in levels ? { powerLevel: levels[userId] ?? 0, membership: memberships[userId] ?? "join" } : null,
        currentState: { hasSufficientPowerLevelFor: (_action: string, level: number) => level >= needed },
    }) as unknown as Room;

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe("mute and favourite", () => {
    it("mutes a conversation, and unmutes it back to the default", async () => {
        const client = {} as MatrixClient;
        (adapter.getRoomNotificationMode as ReturnType<typeof vi.fn>).mockReturnValue("default");
        expect(await toggleRoomMute(client, "!dm")).toBe(true);
        expect(adapter.setRoomNotificationMode).toHaveBeenLastCalledWith(client, "!dm", "mute");
        (adapter.getRoomNotificationMode as ReturnType<typeof vi.fn>).mockReturnValue("mute");
        expect(await toggleRoomMute(client, "!dm")).toBe(false);
        expect(adapter.setRoomNotificationMode).toHaveBeenLastCalledWith(client, "!dm", "default");
    });

    it("favourites with the m.favourite tag, and takes it off again", async () => {
        const client = { setRoomTag: vi.fn(async () => ({})), deleteRoomTag: vi.fn(async () => ({})) } as unknown as MatrixClient;
        expect(await toggleFavourite(client, fakeRoom({ id: "!dm" }))).toBe(true);
        expect(client.setRoomTag).toHaveBeenCalledWith("!dm", "m.favourite", {});
        expect(await toggleFavourite(client, fakeRoom({ id: "!dm", tags: { "m.favourite": {} } }))).toBe(false);
        expect(client.deleteRoomTag).toHaveBeenCalledWith("!dm", "m.favourite");
    });

    it("puts favourites first, each group keeping its order", () => {
        const rooms = [fakeRoom({ id: "a" }), fakeRoom({ id: "b", tags: { "m.favourite": {} } }), fakeRoom({ id: "c" }), fakeRoom({ id: "d", tags: { "m.favourite": {} } })];
        expect(favouritesFirst(rooms).map((room) => room.roomId)).toEqual(["b", "d", "a", "c"]);
    });
});

describe("block and copy", () => {
    it("adds them to the ignore list, keeping everyone already on it", async () => {
        const client = { getIgnoredUsers: () => ["@old:example.org"], setIgnoredUsers: vi.fn(async () => ({})) } as unknown as MatrixClient;
        await blockUser(client, TARGET);
        expect(client.setIgnoredUsers).toHaveBeenCalledWith(["@old:example.org", TARGET]);
    });

    it("doesn't write the list again for someone already blocked", async () => {
        const client = { getIgnoredUsers: () => [TARGET], setIgnoredUsers: vi.fn() } as unknown as MatrixClient;
        await blockUser(client, TARGET);
        expect(client.setIgnoredUsers).not.toHaveBeenCalled();
    });

    it("copies the full user ID, and says so when copying isn't possible", async () => {
        const writeText = vi.fn(async () => undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        await copyUserId(TARGET);
        expect(writeText).toHaveBeenCalledWith(TARGET);
        vi.stubGlobal("navigator", {});
        await expect(copyUserId(TARGET)).rejects.toThrow("Copying isn't available here.");
    });
});

describe("removing and banning across a Space", () => {
    const client = () => ({ kick: vi.fn(async () => ({})), ban: vi.fn(async () => ({})) }) as unknown as MatrixClient & { kick: ReturnType<typeof vi.fn>; ban: ReturnType<typeof vi.fn> };

    it("removes them from the Space first, then the channels they're in", async () => {
        const c = client();
        const space = fakeRoom({ id: "!space", levels: { [ME]: 50 } });
        const general = fakeRoom({ id: "!general", levels: { [ME]: 50 }, memberships: { [TARGET]: "join" } });
        const elsewhere = fakeRoom({ id: "!elsewhere", levels: { [ME]: 50 }, memberships: { [TARGET]: "leave" } });
        const result = await removeFromScope(c, [space, general, elsewhere], TARGET, ME);
        expect(c.kick.mock.calls.map((call) => call[0])).toEqual(["!space", "!general"]);
        expect(result).toEqual({ done: 2, failed: 0 });
    });

    it("bans them in every channel, joined or not, so they can't come back", async () => {
        const c = client();
        const space = fakeRoom({ id: "!space", levels: { [ME]: 100 } });
        const general = fakeRoom({ id: "!general", levels: { [ME]: 100 }, memberships: { [TARGET]: "join" } });
        const elsewhere = fakeRoom({ id: "!elsewhere", levels: { [ME]: 100 } });
        const already = fakeRoom({ id: "!already", levels: { [ME]: 100 }, memberships: { [TARGET]: "ban" } });
        expect(await banFromScope(c, [space, general, elsewhere, already], TARGET, ME)).toEqual({ done: 3, failed: 0 });
        expect(c.ban.mock.calls.map((call) => call[0])).toEqual(["!space", "!general", "!elsewhere"]);
    });

    it("doesn't try at all when their rank is as high as yours: a clear reason, nothing sent", async () => {
        const c = client();
        const space = fakeRoom({ id: "!space", levels: { [ME]: 50, [TARGET]: 100 } });
        await expect(banFromScope(c, [space], TARGET, ME)).rejects.toBeInstanceOf(OutrankedError);
        await expect(removeFromScope(c, [fakeRoom({ id: "!space", levels: { [ME]: 50, [TARGET]: 50 } })], TARGET, ME)).rejects.toThrow(
            "Their rank is the same as yours or higher",
        );
        expect(c.ban).not.toHaveBeenCalled();
        expect(c.kick).not.toHaveBeenCalled();
    });

    it("stops at the Space when the server refuses there, and counts channels it can't do", async () => {
        const c = client();
        c.kick.mockRejectedValueOnce(Object.assign(new Error("MatrixError: [403] forbidden"), { data: { error: "You don't have permission." } }));
        const space = fakeRoom({ id: "!space", levels: { [ME]: 50 } });
        const general = fakeRoom({ id: "!general", levels: { [ME]: 50 }, memberships: { [TARGET]: "join" } });
        await expect(removeFromScope(c, [space, general], TARGET, ME)).rejects.toThrow();
        expect(c.kick).toHaveBeenCalledTimes(1);

        const c2 = client();
        const lowRankChannel = fakeRoom({ id: "!staff", levels: { [ME]: 50 }, memberships: { [TARGET]: "join" }, needed: 100 });
        const failing = fakeRoom({ id: "!flaky", levels: { [ME]: 50 }, memberships: { [TARGET]: "join" } });
        c2.kick.mockImplementation(async (roomId: string) => {
            if (roomId === "!flaky") {
                throw new Error("network");
            }
            return {};
        });
        expect(await removeFromScope(c2, [space, lowRankChannel, failing], TARGET, ME)).toEqual({ done: 1, failed: 2 });
    });
});

describe("describeMenuError", () => {
    it("uses the server's own words, a rank reason as it is, and never MatrixError text", () => {
        expect(describeMenuError(Object.assign(new Error("MatrixError: [403] M_FORBIDDEN"), { data: { error: "You cannot ban user @a:b." } }), "Couldn't ban them.")).toBe(
            "Couldn't ban them. You cannot ban user @a:b.",
        );
        expect(describeMenuError(new Error("MatrixError: [500] M_UNKNOWN"), "Couldn't ban them.")).toBe("Couldn't ban them.");
        expect(describeMenuError(new OutrankedError("Their rank is the same as yours or higher."), "x")).toBe("Their rank is the same as yours or higher.");
        expect(describeMenuError(new Error("Couldn't mark it as read. Try again."), "x")).toBe("Couldn't mark it as read. Try again.");
    });
});

import { describe, expect, it, vi } from "vitest";

import { latestMarkableEvent, markRoomsRead } from "../../../../src/ui/notifications/markRead";

const ME = "@me:example.org";

function event(id: string, sender: string, type = "m.room.message", status: string | null = null) {
    return {
        getId: () => id,
        getSender: () => sender,
        getType: () => type,
        getRelation: () => null,
        isRedacted: () => false,
        status,
    };
}

function room(roomId: string, events: ReturnType<typeof event>[], readUpTo: string | null, serverCount = 0) {
    const ids = events.map((entry) => entry.getId());
    return {
        roomId,
        getLiveTimeline: () => ({ getEvents: () => events }),
        timeline: events,
        // Read up to an event means everything up to it, and your own messages are read.
        hasUserReadEvent: (_userId: string, eventId: string) => {
            const at = ids.indexOf(eventId);
            const own = events[at]?.getSender() === ME;
            return own || (readUpTo !== null && at <= ids.indexOf(readUpTo));
        },
        getUnreadNotificationCount: () => serverCount,
    } as never;
}

function client(fail: string[] = []) {
    return {
        getUserId: () => ME,
        setRoomReadMarkers: vi.fn(async (roomId: string) => {
            if (fail.includes(roomId)) {
                throw new Error("nope");
            }
            return {};
        }),
    };
}

describe("latestMarkableEvent", () => {
    it("takes the newest event of any kind, not only messages Jorvik shows", () => {
        const sticker = event("$sticker", "@lilith:example.org", "m.sticker");
        expect(latestMarkableEvent(room("!a", [event("$mine", ME), sticker], "$mine"))).toBe(sticker);
    });

    it("skips our own messages the server doesn't have yet", () => {
        const sent = event("$sent", ME);
        expect(latestMarkableEvent(room("!a", [sent, event("~local", ME, "m.room.message", "sending")], null))).toBe(sent);
    });
});

describe("markRoomsRead", () => {
    it("marks each unread room up to its newest event, including one only a hidden event made unread", async () => {
        const c = client();
        const stuck = room("!stuck", [event("$mine", ME), event("$sticker", "@lilith:example.org", "m.sticker")], "$mine");
        const unread = room("!unread", [event("$1", "@bob:example.org"), event("$2", "@bob:example.org")], "$1");
        const read = room("!read", [event("$3", "@bob:example.org")], "$3");

        await expect(markRoomsRead(c as never, [stuck, unread, read])).resolves.toEqual({ marked: 2, failed: 0 });
        expect(c.setRoomReadMarkers.mock.calls.map((call) => [call[0], call[1]])).toEqual([
            ["!stuck", "$sticker"],
            ["!unread", "$2"],
        ]);
    });

    it("also clears a room only the server still counts, and carries on past a failure", async () => {
        const c = client(["!first"]);
        const counted = room("!first", [event("$a", "@bob:example.org")], "$a", 1);
        const next = room("!next", [event("$b", "@bob:example.org"), event("$c", "@bob:example.org")], "$b");

        await expect(markRoomsRead(c as never, [counted, next])).resolves.toEqual({ marked: 1, failed: 1 });
        expect(c.setRoomReadMarkers).toHaveBeenCalledTimes(2);
    });
});

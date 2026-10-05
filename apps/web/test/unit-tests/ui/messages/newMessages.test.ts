import { describe, expect, it } from "vitest";

import {
    formatSince,
    locateNewMessages,
    mayBeMessage,
    newMessagesLabel,
    readUpToEventIds,
} from "../../../../src/ui/messages/newMessages";

const ME = "@me:matrix.jorvik.app";
const RIFF = "@riff:matrix.jorvik.app";

interface FakeEventOptions {
    id?: string;
    sender?: string;
    type?: string;
    redacted?: boolean;
}

function fakeEvent({ id, sender = RIFF, type = "m.room.message", redacted = false }: FakeEventOptions) {
    return {
        getId: () => id,
        getSender: () => sender,
        getType: () => type,
        isRedacted: () => redacted,
    } as never;
}

const ids = (...names: string[]) => names.map((name) => `$${name}`);

describe("locateNewMessages", () => {
    // A membership change, then messages: $a (riff), $b (me), $c (riff), $d (riff).
    const member = fakeEvent({ id: "$join", type: "m.room.member" });
    const a = fakeEvent({ id: "$a" });
    const b = fakeEvent({ id: "$b", sender: ME });
    const c = fakeEvent({ id: "$c" });
    const d = fakeEvent({ id: "$d" });
    const timeline = [member, a, b, c, d];
    const messages = [a, b, c, d];

    it("puts the line before the first message from someone else after where reading stopped", () => {
        expect(locateNewMessages(timeline, messages, ids("a"), ME)).toEqual({
            firstNewEventId: "$c",
            count: 2,
            readPositionLoaded: true,
        });
    });

    it("goes by the latest of the receipts and the fully-read marker", () => {
        expect(locateNewMessages(timeline, messages, ids("join", "c"), ME).firstNewEventId).toBe("$d");
        expect(locateNewMessages(timeline, messages, ids("c", "join"), ME).firstNewEventId).toBe("$d");
    });

    it("works from any event, not only a message", () => {
        expect(locateNewMessages(timeline, messages, ids("join"), ME)).toEqual({
            firstNewEventId: "$a",
            count: 3,
            readPositionLoaded: true,
        });
    });

    it("finds nothing new when the rest is your own", () => {
        expect(locateNewMessages(timeline, messages, ids("d"), ME).count).toBe(0);
        expect(locateNewMessages([a, b], [a, b], ids("a"), ME)).toEqual({
            firstNewEventId: null,
            count: 0,
            readPositionLoaded: true,
        });
    });

    it("counts everything loaded, with no place for the line, when reading stopped further back", () => {
        expect(locateNewMessages(timeline, messages, ids("older"), ME)).toEqual({
            firstNewEventId: null,
            count: 3,
            readPositionLoaded: false,
        });
    });

    it("ignores ids from receipts it does not have, if another one is loaded", () => {
        expect(locateNewMessages(timeline, messages, ids("older", "c"), ME).firstNewEventId).toBe("$d");
    });

    it("skips messages that are not in the timeline, such as ones still sending", () => {
        const pending = fakeEvent({ id: "~local", sender: RIFF });
        expect(locateNewMessages(timeline, [...messages, pending], ids("d"), ME).count).toBe(0);
    });
});

describe("mayBeMessage", () => {
    it("takes messages, stickers and still-encrypted events, but not other events or deleted ones", () => {
        expect(mayBeMessage(fakeEvent({ type: "m.room.message" }))).toBe(true);
        expect(mayBeMessage(fakeEvent({ type: "m.sticker" }))).toBe(true);
        expect(mayBeMessage(fakeEvent({ type: "m.room.encrypted" }))).toBe(true);
        expect(mayBeMessage(fakeEvent({ type: "m.reaction" }))).toBe(false);
        expect(mayBeMessage(fakeEvent({ type: "m.room.member" }))).toBe(false);
        expect(mayBeMessage(fakeEvent({ type: "m.room.message", redacted: true }))).toBe(false);
    });
});

describe("readUpToEventIds", () => {
    function fakeRoom(fullyRead: unknown, receipts: Record<string, string | undefined>) {
        return {
            getAccountData: (type: string) =>
                type === "m.fully_read" && fullyRead !== undefined
                    ? { getContent: () => ({ event_id: fullyRead }) }
                    : undefined,
            getReadReceiptForUserId: (_userId: string, _ignoreSynthesized: boolean, receiptType: string) => {
                const eventId = receipts[receiptType];
                return eventId ? { eventId, data: { ts: 0 } } : null;
            },
        } as never;
    }

    it("collects the fully-read marker and both kinds of read receipt, once each", () => {
        expect(readUpToEventIds(fakeRoom("$a", { "m.read": "$b", "m.read.private": "$a" }), ME)).toEqual(["$a", "$b"]);
    });

    it("is empty for a room never read", () => {
        expect(readUpToEventIds(fakeRoom(undefined, {}), ME)).toEqual([]);
        expect(readUpToEventIds(fakeRoom(42, {}), ME)).toEqual([]);
    });
});

describe("newMessagesLabel", () => {
    const now = new Date(2026, 9, 5, 15, 30);
    const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).getTime();
    const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    it("counts with the time of the first new message", () => {
        expect(newMessagesLabel(12, at(5, 14, 2), now)).toBe(`12 new messages since ${time(at(5, 14, 2))}`);
        expect(newMessagesLabel(1, at(5, 14, 2), now)).toBe(`1 new message since ${time(at(5, 14, 2))}`);
    });

    it("says when the first new message was on an earlier day", () => {
        expect(formatSince(at(4, 23, 50), now)).toBe(`yesterday at ${time(at(4, 23, 50))}`);
        const day = new Date(at(2, 9, 0)).toLocaleDateString([], { month: "short", day: "numeric" });
        expect(formatSince(at(2, 9, 0), now)).toBe(`${day} at ${time(at(2, 9, 0))}`);
    });

    it("gives a minimum without a time when the first new message isn't loaded", () => {
        expect(newMessagesLabel(20, null, now)).toBe("20+ new messages");
    });
});

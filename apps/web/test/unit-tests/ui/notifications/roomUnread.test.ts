import { describe, expect, it } from "vitest";

import { hasUnreadActivity, summarizeUnread } from "../../../../src/ui/notifications/roomUnread";

const ME = "@me:matrix.jorvik.app";

interface FakeOptions {
    total?: number;
    highlight?: number;
    lastSender?: string | null;
    read?: boolean;
    muted?: boolean;
}

function fakeRoom({ total = 0, highlight = 0, lastSender = null, read = false, muted = false }: FakeOptions) {
    const events = lastSender
        ? [{ getId: () => "$last", getSender: () => lastSender, getType: () => "m.room.message", getRelation: () => null, isRedacted: () => false }]
        : [];
    return {
        muted,
        getUnreadNotificationCount: (type?: string) => (type === "highlight" ? highlight : total),
        getLiveTimeline: () => ({ getEvents: () => events }),
        timeline: events,
        hasUserReadEvent: () => read,
    } as never;
}

const isMuted = (room: { muted: boolean }) => room.muted;

function summary(rooms: unknown[], countEveryMessage = false) {
    return summarizeUnread(rooms as never[], ME, isMuted as never, countEveryMessage);
}

describe("summarizeUnread", () => {
    it("counts only mentions for a space, but every message for DMs", () => {
        const rooms = [fakeRoom({ total: 5, highlight: 2 }), fakeRoom({ total: 3, highlight: 1 })];
        expect(summary(rooms)).toEqual({ unread: true, count: 3 });
        expect(summary(rooms, true)).toEqual({ unread: true, count: 8 });
    });

    it("lights up for unread messages that don't notify, such as in a mentions-only room", () => {
        expect(summary([fakeRoom({ lastSender: "@riff:matrix.jorvik.app" })])).toEqual({ unread: true, count: 0 });
    });

    it("stays dark when everything is read, or the last message is your own", () => {
        expect(summary([fakeRoom({ lastSender: "@riff:matrix.jorvik.app", read: true })])).toEqual({ unread: false, count: 0 });
        expect(summary([fakeRoom({ lastSender: ME })])).toEqual({ unread: false, count: 0 });
        expect(summary([])).toEqual({ unread: false, count: 0 });
    });

    it("ignores new messages in muted rooms, but still counts their mentions", () => {
        expect(summary([fakeRoom({ lastSender: "@riff:matrix.jorvik.app", muted: true })])).toEqual({ unread: false, count: 0 });
        expect(summary([fakeRoom({ total: 1, highlight: 1, muted: true })])).toEqual({ unread: false, count: 1 });
    });
});

describe("hasUnreadActivity", () => {
    const LILITH = "@lilith:matrix.jorvik.app";

    // Your own message, then one event from Lilith; read up to (and including) yours.
    function roomEndingWith(type: string, relation: { rel_type: string } | null = null) {
        const events = [
            { getId: () => "$mine", getSender: () => ME, getType: () => "m.room.message", getRelation: () => null, isRedacted: () => false },
            { getId: () => "$theirs", getSender: () => LILITH, getType: () => type, getRelation: () => relation, isRedacted: () => false },
        ];
        return {
            getLiveTimeline: () => ({ getEvents: () => events }),
            timeline: events,
            hasUserReadEvent: (_userId: string, eventId: string) => eventId === "$mine",
        } as never;
    }

    it("lights up for a new message, a sticker, or one still being decrypted", () => {
        expect(hasUnreadActivity(roomEndingWith("m.room.message"), ME)).toBe(true);
        expect(hasUnreadActivity(roomEndingWith("m.sticker"), ME)).toBe(true);
        expect(hasUnreadActivity(roomEndingWith("m.room.encrypted"), ME)).toBe(true);
    });

    it("stays dark for what Jorvik doesn't show: a call answered or hung up, a reaction, an edit", () => {
        expect(hasUnreadActivity(roomEndingWith("org.heorot.call.answer"), ME)).toBe(false);
        expect(hasUnreadActivity(roomEndingWith("org.heorot.call.hangup"), ME)).toBe(false);
        expect(hasUnreadActivity(roomEndingWith("m.reaction", { rel_type: "m.annotation" }), ME)).toBe(false);
        expect(hasUnreadActivity(roomEndingWith("m.room.message", { rel_type: "m.replace" }), ME)).toBe(false);
    });
});

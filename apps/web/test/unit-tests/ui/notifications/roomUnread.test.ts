import { describe, expect, it } from "vitest";

import { summarizeUnread } from "../../../../src/ui/notifications/roomUnread";

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
        ? [{ getId: () => "$last", getSender: () => lastSender, getType: () => "m.room.message", isRedacted: () => false }]
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

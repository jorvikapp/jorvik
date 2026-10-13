import { describe, expect, it } from "vitest";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";

import { collectInvites, collectMentions, inboxBadgeCount } from "../../../../src/ui/notifications/phoneInbox";
import { inboxTimeLabel } from "../../../../src/ui/components/phone/PhoneNotificationsView";

const ME = "@me:test.local";

interface FakeEventOptions {
    id: string;
    sender?: string;
    type?: string;
    body?: string;
    ts?: number;
    relation?: { rel_type: string } | null;
    redacted?: boolean;
}

function fakeEvent({ id, sender = "@bob:test.local", type = "m.room.message", body = "hello", ts = 1, relation = null, redacted = false }: FakeEventOptions): MatrixEvent {
    return {
        getId: () => id,
        getSender: () => sender,
        getType: () => type,
        getContent: () => ({ msgtype: "m.text", body }),
        getTs: () => ts,
        getRelation: () => relation,
        isRedacted: () => redacted,
        isDecryptionFailure: () => false,
    } as unknown as MatrixEvent;
}

interface FakeRoomOptions {
    roomId: string;
    membership?: string;
    space?: boolean;
    events?: MatrixEvent[];
    read?: string[];
    inviter?: string;
    inviteTs?: number;
    highlights?: number;
}

function fakeRoom({ roomId, membership = "join", space = false, events = [], read = [], inviter, inviteTs = 0, highlights = 0 }: FakeRoomOptions): Room {
    return {
        roomId,
        getMyMembership: () => membership,
        isSpaceRoom: () => space,
        getDMInviter: () => undefined,
        currentState: {
            getStateEvents: (type: string, stateKey: string) =>
                inviter && type === "m.room.member" && stateKey === ME ? { getSender: () => inviter, getTs: () => inviteTs } : null,
        },
        getLiveTimeline: () => ({ getEvents: () => events }),
        hasUserReadEvent: (_userId: string, eventId: string) => read.includes(eventId),
        getUnreadNotificationCount: (type?: string) => (type === "highlight" ? highlights : 0),
    } as unknown as Room;
}

function clientHighlighting(eventIds: string[]): MatrixClient {
    return {
        getPushActionsForEvent: (event: MatrixEvent) => ({
            notify: true,
            tweaks: { highlight: eventIds.includes(event.getId() ?? "") },
        }),
    } as unknown as MatrixClient;
}

describe("collectInvites", () => {
    it("lists pending invites newest first, saying what each is for", () => {
        const rooms = [
            fakeRoom({ roomId: "!joined", membership: "join" }),
            fakeRoom({ roomId: "!space", membership: "invite", space: true, inviter: "@sigrid:test.local", inviteTs: 20 }),
            fakeRoom({ roomId: "!dm", membership: "invite", inviter: "@gunnar:test.local", inviteTs: 30 }),
            fakeRoom({ roomId: "!channel", membership: "invite", inviter: "@ivar:test.local", inviteTs: 10 }),
        ];

        const invites = collectInvites(rooms, ME, (room) => room.roomId === "!dm");

        expect(invites.map((invite) => [invite.roomId, invite.kind, invite.inviterId])).toEqual([
            ["!dm", "direct", "@gunnar:test.local"],
            ["!space", "space", "@sigrid:test.local"],
            ["!channel", "room", "@ivar:test.local"],
        ]);
    });
});

describe("collectMentions", () => {
    it("lists what mentions you, newest first, read or not", () => {
        const general = fakeRoom({
            roomId: "!general",
            events: [
                fakeEvent({ id: "$old", ts: 1, body: "@me look" }),
                fakeEvent({ id: "$plain", ts: 2, body: "no mention" }),
                fakeEvent({ id: "$new", ts: 5, body: "@me again" }),
            ],
            read: ["$old"],
        });
        const dm = fakeRoom({ roomId: "!dm", events: [fakeEvent({ id: "$dm", ts: 3, body: "hey @me" })] });

        const mentions = collectMentions(clientHighlighting(["$old", "$new", "$dm"]), [general, dm], ME);

        expect(mentions.map((mention) => [mention.eventId, mention.unread])).toEqual([
            ["$new", true],
            ["$dm", true],
            ["$old", false],
        ]);
        expect(mentions[0]).toMatchObject({ roomId: "!general", senderId: "@bob:test.local", body: "@me again" });
    });

    it("leaves out your own messages, edits, redactions and things that aren't messages", () => {
        const room = fakeRoom({
            roomId: "!room",
            events: [
                fakeEvent({ id: "$own", sender: ME }),
                fakeEvent({ id: "$edit", relation: { rel_type: "m.replace" } }),
                fakeEvent({ id: "$gone", redacted: true }),
                fakeEvent({ id: "$reaction", type: "m.reaction" }),
                fakeEvent({ id: "$kept" }),
            ],
        });

        const mentions = collectMentions(clientHighlighting(["$own", "$edit", "$gone", "$reaction", "$kept"]), [room], ME);

        expect(mentions.map((mention) => mention.eventId)).toEqual(["$kept"]);
    });

    it("only looks in rooms you're in, and not in spaces", () => {
        const event = fakeEvent({ id: "$x" });
        const rooms = [
            fakeRoom({ roomId: "!invited", membership: "invite", events: [event] }),
            fakeRoom({ roomId: "!space", space: true, events: [event] }),
        ];

        expect(collectMentions(clientHighlighting(["$x"]), rooms, ME)).toEqual([]);
    });

    it("keeps the newest when there are more than the limit", () => {
        const events = [1, 2, 3, 4].map((ts) => fakeEvent({ id: `$${ts}`, ts }));
        const room = fakeRoom({ roomId: "!room", events });

        const mentions = collectMentions(clientHighlighting(["$1", "$2", "$3", "$4"]), [room], ME, 2);

        expect(mentions.map((mention) => mention.eventId)).toEqual(["$4", "$3"]);
    });
});

describe("inboxBadgeCount", () => {
    it("adds invites to the unread mentions in rooms you're in", () => {
        const rooms = [
            fakeRoom({ roomId: "!a", highlights: 2 }),
            fakeRoom({ roomId: "!b", highlights: 1 }),
            fakeRoom({ roomId: "!invited", membership: "invite", highlights: 5 }),
        ];

        expect(inboxBadgeCount(rooms, 1)).toBe(4);
    });
});

describe("inboxTimeLabel", () => {
    const now = new Date(2026, 9, 13, 18, 30).getTime();

    it("shows the time for today, and words for the last few days", () => {
        expect(inboxTimeLabel(new Date(2026, 9, 13, 9, 5).getTime(), now)).toMatch(/\d/);
        expect(inboxTimeLabel(new Date(2026, 9, 12, 23, 0).getTime(), now)).toBe("Yesterday");
        expect(inboxTimeLabel(new Date(2026, 9, 9, 12, 0).getTime(), now)).toBe(
            new Date(2026, 9, 9).toLocaleDateString(undefined, { weekday: "long" }),
        );
    });

    it("shows the date for anything older, and nothing without a time", () => {
        expect(inboxTimeLabel(new Date(2026, 8, 1).getTime(), now)).toBe(
            new Date(2026, 8, 1).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        );
        expect(inboxTimeLabel(0, now)).toBe("");
    });
});

import type { MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { describe, expect, it } from "vitest";

import { canEditMessage, findLastEditableMessage } from "../../../../src/ui/messages/editableMessages";

const ME = "@me:matrix.jorvik.app";

interface FakeEventOptions {
    id?: string;
    sender?: string;
    type?: string;
    msgtype?: string;
    redacted?: boolean;
    replaces?: boolean;
}

function fakeEvent({ id = "$event", sender = ME, type = "m.room.message", msgtype = "m.text", redacted = false, replaces = false }: FakeEventOptions = {}) {
    return {
        getId: () => id,
        getSender: () => sender,
        getType: () => type,
        getContent: () => ({ msgtype, body: "text" }),
        isRedacted: () => redacted,
        isRelation: (relType?: string) => replaces && (relType === undefined || relType === "m.replace"),
    } as unknown as MatrixEvent;
}

function fakeRoom(events: MatrixEvent[]): Room {
    return { getLiveTimeline: () => ({ getEvents: () => events }) } as unknown as Room;
}

describe("canEditMessage", () => {
    it("allows only your own text messages that are still there", () => {
        expect(canEditMessage(fakeEvent(), ME)).toBe(true);
        expect(canEditMessage(fakeEvent({ sender: "@other:matrix.jorvik.app" }), ME)).toBe(false);
        expect(canEditMessage(fakeEvent({ msgtype: "m.image" }), ME)).toBe(false);
        expect(canEditMessage(fakeEvent({ redacted: true }), ME)).toBe(false);
        expect(canEditMessage(fakeEvent({ type: "m.reaction" }), ME)).toBe(false);
        expect(canEditMessage(fakeEvent(), null)).toBe(false);
    });
});

describe("findLastEditableMessage", () => {
    it("finds your latest text message, even with others' messages after it", () => {
        const mine = fakeEvent({ id: "$mine" });
        const room = fakeRoom([fakeEvent({ id: "$older" }), mine, fakeEvent({ id: "$theirs", sender: "@other:matrix.jorvik.app" })]);
        expect(findLastEditableMessage(room, ME)).toBe(mine);
    });

    it("skips edits, deleted messages, images and messages still sending", () => {
        const mine = fakeEvent({ id: "$mine" });
        const room = fakeRoom([
            mine,
            fakeEvent({ id: "$edit", replaces: true }),
            fakeEvent({ id: "$gone", redacted: true }),
            fakeEvent({ id: "$image", msgtype: "m.image" }),
            fakeEvent({ id: "~!room:matrix.jorvik.app:m1" }),
        ]);
        expect(findLastEditableMessage(room, ME)).toBe(mine);
    });

    it("finds nothing when you haven't written anything", () => {
        expect(findLastEditableMessage(fakeRoom([fakeEvent({ sender: "@other:matrix.jorvik.app" })]), ME)).toBeNull();
        expect(findLastEditableMessage(fakeRoom([]), ME)).toBeNull();
    });
});

import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

import {
    CALL_ANSWER_EVENT,
    CALL_HANGUP_EVENT,
    CALL_RING_LIFETIME_MS,
    parseCallRing,
    parseCallSignal,
    sendCallAnswer,
    sendCallHangup,
    sendCallRing,
} from "../../../../src/core/calls/callSignals";

const ROOM = "!dm:example.org";

function ring(content: Record<string, unknown>, ageMs = 1_000): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        room_id: ROOM,
        sender: "@alice:example.org",
        event_id: "$ring",
        origin_server_ts: Date.now() - ageMs,
        unsigned: { age: ageMs },
        content,
    });
}

describe("parseCallRing", () => {
    it("reads a fresh ring and how long it still rings", () => {
        const parsed = parseCallRing(ring({ msgtype: "org.heorot.call", body: "📞 Started a call", "org.heorot.call": { call_id: "c1", lifetime: 30_000 } }, 4_000));
        expect(parsed).toMatchObject({ roomId: ROOM, callId: "c1", callerId: "@alice:example.org" });
        expect(parsed!.remainingMs).toBeGreaterThan(25_000);
        expect(parsed!.remainingMs).toBeLessThanOrEqual(26_000);
    });

    it("ignores expired rings, other messages and malformed ones", () => {
        expect(parseCallRing(ring({ msgtype: "org.heorot.call", "org.heorot.call": { call_id: "c1" } }, CALL_RING_LIFETIME_MS + 1_000))).toBeNull();
        expect(parseCallRing(ring({ msgtype: "m.text", body: "📞 Started a call" }))).toBeNull();
        expect(parseCallRing(ring({ msgtype: "org.heorot.call", "org.heorot.call": {} }))).toBeNull();
    });
});

describe("parseCallSignal", () => {
    const signal = (type: string, content: Record<string, unknown>) =>
        parseCallSignal(new MatrixEvent({ type, room_id: ROOM, sender: "@bob:example.org", event_id: "$s", content }));

    it("reads answers and hang-ups, defaulting an unknown reason to cancelled", () => {
        expect(signal(CALL_ANSWER_EVENT, { call_id: "c1" })).toEqual({ kind: "answer", roomId: ROOM, callId: "c1", senderId: "@bob:example.org" });
        expect(signal(CALL_HANGUP_EVENT, { call_id: "c1", reason: "declined" })).toMatchObject({ kind: "hangup", reason: "declined" });
        expect(signal(CALL_HANGUP_EVENT, { call_id: "c1", reason: "weird" })).toMatchObject({ reason: "cancelled" });
        expect(signal(CALL_HANGUP_EVENT, {})).toBeNull();
        expect(signal("m.room.message", { call_id: "c1" })).toBeNull();
    });
});

describe("sending", () => {
    it("sends the ring as a message and the rest as call events", async () => {
        const client = { sendEvent: vi.fn(async () => ({ event_id: "$x" })) };
        await sendCallRing(client as never, ROOM, "c1");
        await sendCallAnswer(client as never, ROOM, "c1");
        await sendCallHangup(client as never, ROOM, "c1", "declined");
        expect(client.sendEvent.mock.calls).toEqual([
            [ROOM, "m.room.message", { msgtype: "org.heorot.call", body: "📞 Started a call", "org.heorot.call": { call_id: "c1", lifetime: CALL_RING_LIFETIME_MS } }],
            [ROOM, CALL_ANSWER_EVENT, { call_id: "c1" }],
            [ROOM, CALL_HANGUP_EVENT, { call_id: "c1", reason: "declined" }],
        ]);
    });
});

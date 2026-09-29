import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MatrixEvent, RoomEvent } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALL_ANSWER_EVENT, CALL_HANGUP_EVENT } from "../../../../src/core/calls/callSignals";
import type { VoiceSessionStatus } from "../../../../src/ui/components/voice/VoiceRoom";

const stopRingtone = vi.fn();
const startRingtone = vi.fn(() => stopRingtone);
vi.mock("../../../../src/ui/notifications/sound", () => ({ startRingtone: () => startRingtone() }));
const createOrReuseDirectChat = vi.fn(async () => ({ roomId: DM, created: false }));
vi.mock("../../../../src/core/dm/directChats", () => ({ createOrReuseDirectChat: (...args: unknown[]) => createOrReuseDirectChat(...(args as [])) }));

const { useCallController } = await import("../../../../src/ui/calls/useCallController");
type Controller = ReturnType<typeof useCallController>;

const DM = "!dm:example.org";
const ME = "@me:example.org";
const THEM = "@them:example.org";

let container: HTMLDivElement;
let root: Root;
let controller: Controller;
let eventCounter = 0;

function makeClient(theirMembership = "join") {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        getUserId: () => ME,
        getUser: () => null,
        getRoom: () => ({ getMyMembership: () => "join", getMember: () => ({ membership: theirMembership }) }),
        sendEvent: vi.fn(async () => ({ event_id: "$sent" })),
        removeListener: emitter.removeListener.bind(emitter),
    });
}
type FakeClient = ReturnType<typeof makeClient>;

interface Session { roomId: string | null; status: VoiceSessionStatus; participants: Map<string, Set<string>>; }

function makeOptions(client: FakeClient, session: Session, doNotDisturb = false) {
    return {
        client: client as never,
        doNotDisturb,
        voiceSessionRoomId: session.roomId,
        voiceSessionStatus: session.status,
        voiceParticipantsByRoomId: session.participants,
        startVoiceSession: vi.fn(),
        leaveVoiceSession: vi.fn(),
        openRoom: vi.fn(),
        notify: vi.fn(),
    };
}

function Probe({ options }: { options: ReturnType<typeof makeOptions> }): null {
    controller = useCallController(options);
    return null;
}

function render(options: ReturnType<typeof makeOptions>): void {
    act(() => root.render(<Probe options={options} />));
}

function emit(client: FakeClient, type: string, sender: string, content: Record<string, unknown>): void {
    const event = new MatrixEvent({ type, room_id: DM, sender, event_id: `$e${++eventCounter}`, origin_server_ts: Date.now(), unsigned: { age: 500 }, content });
    act(() => {
        client.emit(RoomEvent.Timeline, event, undefined, false, false, { liveEvent: true });
    });
}

const ringFrom = (client: FakeClient, sender = THEM, callId = "c1") =>
    emit(client, "m.room.message", sender, { msgtype: "org.heorot.call", body: "📞 Started a call", "org.heorot.call": { call_id: callId, lifetime: 30_000 } });

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    startRingtone.mockClear();
    stopRingtone.mockClear();
    createOrReuseDirectChat.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

describe("incoming calls", () => {
    it("rings, and accepting answers, opens the DM and joins the call", () => {
        const client = makeClient();
        const options = makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() });
        render(options);
        ringFrom(client);
        expect(controller.incomingCall).toMatchObject({ roomId: DM, callId: "c1", callerId: THEM });
        expect(startRingtone).toHaveBeenCalledTimes(1);

        act(() => controller.acceptIncomingCall());
        expect(controller.incomingCall).toBeNull();
        expect(stopRingtone).toHaveBeenCalled();
        expect(client.sendEvent).toHaveBeenCalledWith(DM, CALL_ANSWER_EVENT, { call_id: "c1" });
        expect(options.openRoom).toHaveBeenCalledWith(DM);
        expect(options.startVoiceSession).toHaveBeenCalledWith(DM);
    });

    it("declining sends a hang-up and stops ringing", () => {
        const client = makeClient();
        render(makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() }));
        ringFrom(client);
        act(() => controller.declineIncomingCall());
        expect(client.sendEvent).toHaveBeenCalledWith(DM, CALL_HANGUP_EVENT, { call_id: "c1", reason: "declined" });
        expect(stopRingtone).toHaveBeenCalled();
    });

    it("shows the prompt without sound on Do Not Disturb", () => {
        const client = makeClient();
        render(makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() }, true));
        ringFrom(client);
        expect(controller.incomingCall).not.toBeNull();
        expect(startRingtone).not.toHaveBeenCalled();
    });

    it("stops when the caller gives up, when answered elsewhere, and after 30 seconds", () => {
        const client = makeClient();
        const options = makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() });
        render(options);

        ringFrom(client, THEM, "c1");
        emit(client, CALL_HANGUP_EVENT, THEM, { call_id: "c1", reason: "cancelled" });
        expect(controller.incomingCall).toBeNull();
        expect(options.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Missed call") }));

        ringFrom(client, THEM, "c2");
        emit(client, CALL_ANSWER_EVENT, ME, { call_id: "c2" });
        expect(controller.incomingCall).toBeNull();

        ringFrom(client, THEM, "c3");
        act(() => vi.advanceTimersByTime(31_000));
        expect(controller.incomingCall).toBeNull();
    });

    it("ignores our own rings and rings for a call we are already in", () => {
        const client = makeClient();
        render(makeOptions(client, { roomId: DM, status: "connected", participants: new Map() }));
        ringFrom(client, ME, "own");
        ringFrom(client, THEM, "already-in");
        expect(controller.incomingCall).toBeNull();
    });
});

describe("outgoing calls", () => {
    it("rings, and counts as answered once they are in the call", async () => {
        const client = makeClient();
        const session: Session = { roomId: null, status: "disconnected", participants: new Map() };
        let options = makeOptions(client, session);
        render(options);
        await act(async () => controller.startCall(THEM));

        expect(options.openRoom).toHaveBeenCalledWith(DM);
        expect(options.startVoiceSession).toHaveBeenCalledWith(DM);
        expect(client.sendEvent).toHaveBeenCalledWith(DM, "m.room.message", expect.objectContaining({ msgtype: "org.heorot.call" }));
        expect(controller.outgoingCall).toMatchObject({ roomId: DM, calleeId: THEM, answered: false });

        options = makeOptions(client, { roomId: DM, status: "connected", participants: new Map([[DM, new Set([ME, THEM])]]) });
        render(options);
        expect(controller.outgoingCall?.answered).toBe(true);
        act(() => vi.advanceTimersByTime(31_000));
        expect(options.leaveVoiceSession).not.toHaveBeenCalled();
    });

    it("gives up after 30 seconds without an answer", async () => {
        const client = makeClient();
        let options = makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() });
        render(options);
        await act(async () => controller.startCall(THEM));
        options = makeOptions(client, { roomId: DM, status: "connected", participants: new Map([[DM, new Set([ME])]]) });
        render(options);

        act(() => vi.advanceTimersByTime(31_000));
        expect(client.sendEvent).toHaveBeenCalledWith(DM, CALL_HANGUP_EVENT, expect.objectContaining({ reason: "unanswered" }));
        expect(options.leaveVoiceSession).toHaveBeenCalled();
        expect(controller.outgoingCall).toBeNull();
    });

    it("leaves when they decline", async () => {
        const client = makeClient();
        let options = makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() });
        render(options);
        await act(async () => controller.startCall(THEM));
        options = makeOptions(client, { roomId: DM, status: "connected", participants: new Map([[DM, new Set([ME])]]) });
        render(options);

        const callId = controller.outgoingCall!.callId;
        emit(client, CALL_HANGUP_EVENT, THEM, { call_id: callId, reason: "declined" });
        expect(options.leaveVoiceSession).toHaveBeenCalled();
        expect(options.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("declined") }));
        expect(controller.outgoingCall).toBeNull();
    });

    it("sends a cancel when the caller leaves before an answer, but not while the call is still starting", async () => {
        const client = makeClient();
        let options = makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() });
        render(options);
        await act(async () => controller.startCall(THEM));
        expect(controller.outgoingCall).not.toBeNull();

        options = makeOptions(client, { roomId: DM, status: "joining", participants: new Map() });
        render(options);
        options = makeOptions(client, { roomId: DM, status: "disconnected", participants: new Map() });
        render(options);
        expect(client.sendEvent).toHaveBeenCalledWith(DM, CALL_HANGUP_EVENT, expect.objectContaining({ reason: "cancelled" }));
        expect(controller.outgoingCall).toBeNull();
    });

    it("does not ring someone who has not joined the DM yet", async () => {
        const client = makeClient("invite");
        const options = makeOptions(client, { roomId: null, status: "disconnected", participants: new Map() });
        render(options);
        await act(async () => controller.startCall(THEM));
        expect(options.startVoiceSession).not.toHaveBeenCalled();
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(options.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("needs to accept your DM") }));
    });
});

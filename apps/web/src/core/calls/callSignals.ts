import { EventType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * One-to-one calls ride on the DM room: the voice relay issues a LiveKit token
 * for any room the user is in, so the call is simply a voice session on it.
 * These events are only the ringing around it.
 *
 * The ring is a real message, so it notifies like one (and Do Not Disturb
 * silences it) and other Matrix apps show its body. Answer and hang-up are
 * custom event types: the timeline only renders m.room.message, and no push
 * rule matches them once decrypted, so they neither show nor notify.
 */
export const CALL_RING_MSGTYPE = "org.heorot.call";
export const CALL_RING_CONTENT_KEY = "org.heorot.call";
export const CALL_ANSWER_EVENT = "org.heorot.call.answer";
export const CALL_HANGUP_EVENT = "org.heorot.call.hangup";
export const CALL_RING_LIFETIME_MS = 30_000;

export type CallHangupReason = "declined" | "cancelled" | "unanswered";

export interface CallRing {
    roomId: string;
    callId: string;
    callerId: string;
    /** How much longer it rings, as of when it was parsed. */
    remainingMs: number;
}

export interface CallSignal {
    kind: "answer" | "hangup";
    roomId: string;
    callId: string;
    senderId: string;
    reason?: CallHangupReason;
}

export function newCallId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function sendCallRing(client: MatrixClient, roomId: string, callId: string): Promise<void> {
    await client.sendEvent(roomId, EventType.RoomMessage, {
        msgtype: CALL_RING_MSGTYPE,
        body: "📞 Started a call",
        [CALL_RING_CONTENT_KEY]: { call_id: callId, lifetime: CALL_RING_LIFETIME_MS },
    } as any);
}

export async function sendCallAnswer(client: MatrixClient, roomId: string, callId: string): Promise<void> {
    await client.sendEvent(roomId, CALL_ANSWER_EVENT as any, { call_id: callId } as any);
}

export async function sendCallHangup(
    client: MatrixClient,
    roomId: string,
    callId: string,
    reason: CallHangupReason,
): Promise<void> {
    await client.sendEvent(roomId, CALL_HANGUP_EVENT as any, { call_id: callId, reason } as any);
}

function eventAgeMs(event: MatrixEvent): number {
    const localAge = event.getLocalAge();
    return Number.isFinite(localAge) && localAge >= 0 ? localAge : Date.now() - event.getTs();
}

/** A ring that is still ringing, or null. */
export function parseCallRing(event: MatrixEvent): CallRing | null {
    if (event.getType() !== EventType.RoomMessage || event.isRedacted()) {
        return null;
    }
    const content = event.getContent() as Record<string, unknown>;
    if (content.msgtype !== CALL_RING_MSGTYPE) {
        return null;
    }
    const call = content[CALL_RING_CONTENT_KEY] as { call_id?: unknown; lifetime?: unknown } | undefined;
    const roomId = event.getRoomId();
    const callerId = event.getSender();
    if (!call || typeof call.call_id !== "string" || call.call_id.length === 0 || !roomId || !callerId) {
        return null;
    }

    const lifetime =
        typeof call.lifetime === "number" && Number.isFinite(call.lifetime)
            ? Math.min(Math.max(call.lifetime, 5_000), 120_000)
            : CALL_RING_LIFETIME_MS;
    const remainingMs = lifetime - eventAgeMs(event);
    if (remainingMs <= 0) {
        return null;
    }
    return { roomId, callId: call.call_id, callerId, remainingMs };
}

export function parseCallSignal(event: MatrixEvent): CallSignal | null {
    const type = event.getType();
    if (type !== CALL_ANSWER_EVENT && type !== CALL_HANGUP_EVENT) {
        return null;
    }
    const content = event.getContent() as { call_id?: unknown; reason?: unknown };
    const roomId = event.getRoomId();
    const senderId = event.getSender();
    if (typeof content.call_id !== "string" || !roomId || !senderId) {
        return null;
    }
    if (type === CALL_ANSWER_EVENT) {
        return { kind: "answer", roomId, callId: content.call_id, senderId };
    }
    const reason = content.reason === "declined" || content.reason === "cancelled" || content.reason === "unanswered"
        ? content.reason
        : "cancelled";
    return { kind: "hangup", roomId, callId: content.call_id, senderId, reason };
}

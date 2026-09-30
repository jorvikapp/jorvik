import { useCallback, useEffect, useRef, useState } from "react";
import { MatrixEventEvent, RoomEvent, type IRoomTimelineData, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import {
    CALL_RING_LIFETIME_MS,
    newCallId,
    parseCallRing,
    parseCallSignal,
    sendCallAnswer,
    sendCallHangup,
    sendCallRing,
    type CallRing,
} from "../../core/calls/callSignals";
import { createOrReuseDirectChat } from "../../core/dm/directChats";
import { plainUserDisplayName } from "../../core/users/userDisplayName";
import { startRingtone } from "../notifications/sound";
import type { VoiceSessionStatus } from "../components/voice/VoiceRoom";

export interface OutgoingCall {
    roomId: string;
    callId: string;
    calleeId: string;
    answered: boolean;
}

interface CallControllerOptions {
    client: MatrixClient;
    doNotDisturb: boolean;
    voiceSessionRoomId: string | null;
    voiceSessionStatus: VoiceSessionStatus;
    voiceParticipantsByRoomId: Map<string, Set<string>>;
    /** Joins the voice session for a room, as picking a voice channel does. */
    startVoiceSession: (roomId: string) => void;
    leaveVoiceSession: () => void;
    openRoom: (roomId: string) => void;
    notify: (toast: { type: "success" | "error" | "info"; message: string }) => void;
}

export interface CallController {
    incomingCall: CallRing | null;
    outgoingCall: OutgoingCall | null;
    startCall: (userId: string) => Promise<void>;
    acceptIncomingCall: () => void;
    declineIncomingCall: () => void;
}

function displayName(client: MatrixClient, userId: string): string {
    return plainUserDisplayName(client.getUser(userId)) || userId;
}

/**
 * Rings around a voice session on the DM room: the voice itself is the same
 * LiveKit session a voice channel uses.
 */
export function useCallController(options: CallControllerOptions): CallController {
    const { client, doNotDisturb, voiceSessionRoomId, voiceSessionStatus, voiceParticipantsByRoomId } = options;
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [incomingCall, setIncomingCall] = useState<CallRing | null>(null);
    const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
    const incomingRef = useRef(incomingCall);
    incomingRef.current = incomingCall;
    const outgoingRef = useRef(outgoingCall);
    outgoingRef.current = outgoingCall;

    useEffect(() => {
        const handled = new Set<string>();

        const handle = (event: MatrixEvent): void => {
            // Encrypted events come back through Decrypted once readable.
            if (event.isDecryptionFailure() || (event.isEncrypted() && event.getClearContent() === null)) {
                return;
            }
            const eventId = event.getId();
            if (eventId) {
                if (handled.has(eventId)) {
                    return;
                }
                handled.add(eventId);
                if (handled.size > 500) {
                    const oldest = handled.values().next().value;
                    if (typeof oldest === "string") handled.delete(oldest);
                }
            }

            const ownUserId = client.getUserId();
            const ring = parseCallRing(event);
            if (ring) {
                if (ring.callerId === ownUserId || client.getRoom(ring.roomId)?.getMyMembership() !== "join") {
                    return;
                }
                const { voiceSessionRoomId: sessionRoomId, voiceSessionStatus: sessionStatus } = optionsRef.current;
                if (sessionRoomId === ring.roomId && sessionStatus !== "disconnected") {
                    return; // already in that call
                }
                setIncomingCall(ring);
                return;
            }

            const signal = parseCallSignal(event);
            if (!signal) {
                return;
            }

            const incoming = incomingRef.current;
            if (incoming && signal.callId === incoming.callId) {
                // The caller gave up, or we answered or declined on another device.
                setIncomingCall(null);
                if (signal.kind === "hangup" && signal.senderId === incoming.callerId) {
                    optionsRef.current.notify({ type: "info", message: `Missed call from ${displayName(client, incoming.callerId)}.` });
                }
            }

            const outgoing = outgoingRef.current;
            if (outgoing && signal.callId === outgoing.callId && signal.senderId !== ownUserId) {
                if (signal.kind === "answer") {
                    setOutgoingCall({ ...outgoing, answered: true });
                } else if (signal.reason === "declined") {
                    setOutgoingCall(null);
                    optionsRef.current.leaveVoiceSession();
                    optionsRef.current.notify({ type: "info", message: `${displayName(client, signal.senderId)} declined the call.` });
                }
            }
        };

        const onTimeline = (
            event: MatrixEvent,
            _room: unknown,
            toStartOfTimeline: boolean | undefined,
            removed: boolean,
            data?: IRoomTimelineData,
        ): void => {
            if (!removed && !toStartOfTimeline && data?.liveEvent) {
                handle(event);
            }
        };

        client.on(RoomEvent.Timeline, onTimeline);
        client.on(MatrixEventEvent.Decrypted, handle);
        return () => {
            client.removeListener(RoomEvent.Timeline, onTimeline);
            client.removeListener(MatrixEventEvent.Decrypted, handle);
        };
    }, [client]);

    // Ring until answered, declined, cancelled or expired; silently on Do Not Disturb.
    useEffect(() => {
        if (!incomingCall || doNotDisturb) {
            return undefined;
        }
        return startRingtone();
    }, [doNotDisturb, incomingCall]);

    useEffect(() => {
        if (!incomingCall) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            setIncomingCall((current) => (current === incomingCall ? null : current));
        }, incomingCall.remainingMs);
        return () => window.clearTimeout(timeoutId);
    }, [incomingCall]);

    const acceptIncomingCall = useCallback((): void => {
        const call = incomingRef.current;
        if (!call) {
            return;
        }
        setIncomingCall(null);
        void sendCallAnswer(client, call.roomId, call.callId).catch(() => undefined);
        optionsRef.current.openRoom(call.roomId);
        optionsRef.current.startVoiceSession(call.roomId);
    }, [client]);

    const declineIncomingCall = useCallback((): void => {
        const call = incomingRef.current;
        if (!call) {
            return;
        }
        setIncomingCall(null);
        void sendCallHangup(client, call.roomId, call.callId, "declined").catch(() => undefined);
    }, [client]);

    const startCall = useCallback(
        async (userId: string): Promise<void> => {
            const { notify, openRoom, startVoiceSession } = optionsRef.current;
            let roomId: string;
            try {
                roomId = (await createOrReuseDirectChat(client, userId)).roomId;
            } catch (error) {
                notify({ type: "error", message: error instanceof Error ? error.message : "Could not start the call." });
                return;
            }
            openRoom(roomId);

            // Someone who has not joined the DM gets no room events, so no ring.
            if (client.getRoom(roomId)?.getMember(userId)?.membership !== "join") {
                notify({ type: "info", message: `${displayName(client, userId)} needs to accept your DM before you can call them.` });
                return;
            }

            const callId = newCallId();
            setOutgoingCall({ roomId, callId, calleeId: userId, answered: false });
            startVoiceSession(roomId);
            try {
                await sendCallRing(client, roomId, callId);
            } catch {
                notify({ type: "error", message: "Could not ring them. Try again." });
            }
        },
        [client],
    );

    // Answered once anyone else is in the call.
    useEffect(() => {
        if (!outgoingCall || outgoingCall.answered) {
            return;
        }
        const ownUserId = client.getUserId();
        const participants = voiceParticipantsByRoomId.get(outgoingCall.roomId);
        if (participants && [...participants].some((participantId) => participantId !== ownUserId)) {
            setOutgoingCall({ ...outgoingCall, answered: true });
        }
    }, [client, outgoingCall, voiceParticipantsByRoomId]);

    // Nobody answered.
    useEffect(() => {
        if (!outgoingCall || outgoingCall.answered) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            void sendCallHangup(client, outgoingCall.roomId, outgoingCall.callId, "unanswered").catch(() => undefined);
            setOutgoingCall(null);
            optionsRef.current.leaveVoiceSession();
            optionsRef.current.notify({ type: "info", message: "No answer." });
        }, CALL_RING_LIFETIME_MS);
        return () => window.clearTimeout(timeoutId);
    }, [client, outgoingCall]);

    // The caller left (or the join failed) before anyone answered. Only once the
    // session has been seen on the call's room: until then it is still starting.
    const sessionSeenForCallRef = useRef<string | null>(null);
    useEffect(() => {
        if (!outgoingCall) {
            return;
        }
        if (voiceSessionRoomId === outgoingCall.roomId && voiceSessionStatus !== "disconnected") {
            sessionSeenForCallRef.current = outgoingCall.callId;
            return;
        }
        if (sessionSeenForCallRef.current !== outgoingCall.callId) {
            return;
        }
        if (!outgoingCall.answered) {
            void sendCallHangup(client, outgoingCall.roomId, outgoingCall.callId, "cancelled").catch(() => undefined);
        }
        setOutgoingCall(null);
    }, [client, outgoingCall, voiceSessionRoomId, voiceSessionStatus]);

    return { incomingCall, outgoingCall, startCall, acceptIncomingCall, declineIncomingCall };
}

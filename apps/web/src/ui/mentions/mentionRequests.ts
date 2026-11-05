import { useEffect, useRef } from "react";

/**
 * "Mention" from the menu on someone's name: the message box of that room puts them in, at the cursor. The
 * menu and the message box live far apart, so the request goes through here.
 */

type Listener = (userId: string) => void;

const listenersByRoom = new Map<string, Set<Listener>>();

/** Returns whether a message box for the room took it. */
export function requestMention(roomId: string, userId: string): boolean {
    const listeners = listenersByRoom.get(roomId);
    if (!listeners || listeners.size === 0) {
        return false;
    }
    for (const listener of [...listeners]) {
        listener(userId);
    }
    return true;
}

export function useMentionRequests(roomId: string | null | undefined, onRequest: (userId: string) => void): void {
    const onRequestRef = useRef(onRequest);
    onRequestRef.current = onRequest;
    useEffect(() => {
        if (!roomId) {
            return;
        }
        const listener: Listener = (userId) => onRequestRef.current(userId);
        const listeners = listenersByRoom.get(roomId) ?? new Set<Listener>();
        listeners.add(listener);
        listenersByRoom.set(roomId, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                listenersByRoom.delete(roomId);
            }
        };
    }, [roomId]);
}

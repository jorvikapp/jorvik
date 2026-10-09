import { isE2EESupported } from "livekit-client";
import type { MatrixClient, Room as MatrixRoom } from "matrix-js-sdk/src/matrix";

import { getVoiceDiscovery, initVoiceDiscovery } from "./voiceDiscovery";

/**
 * Whether a call in this room is end-to-end encrypted. A call is encrypted when its
 * Matrix room is: then its members' devices are tracked and can be sent the keys. In an
 * encrypted room a client that can't encrypt doesn't join rather than join in clear.
 */
export type CallEncryptionMode = "encrypted" | "room-not-encrypted" | "relay-not-ready" | "browser-unsupported";

export function getCallEncryptionMode(room: MatrixRoom | null | undefined): CallEncryptionMode {
    if (!room?.hasEncryptionStateEvent()) {
        return "room-not-encrypted";
    }
    if (getVoiceDiscovery()?.features.e2eeRooms !== true) {
        return "relay-not-ready";
    }
    if (!isE2EESupported()) {
        return "browser-unsupported";
    }
    return "encrypted";
}

/**
 * getCallEncryptionMode, after another try at voice discovery if it hasn't worked yet: it
 * says whether the relay can do encrypted calls, and without it they can't be joined.
 */
export async function resolveCallEncryptionMode(
    client: MatrixClient,
    room: MatrixRoom | null | undefined,
): Promise<CallEncryptionMode> {
    if (room?.hasEncryptionStateEvent() && !getVoiceDiscovery()) {
        await initVoiceDiscovery(client.getHomeserverUrl());
    }
    return getCallEncryptionMode(room);
}

/**
 * Whether to list who is in this room's call from the relay's encrypted call room. An
 * older relay ignores the request for it and lists its only call room, which is right there.
 */
export function usesEncryptedCallRoom(room: MatrixRoom | null | undefined): boolean {
    return Boolean(room?.hasEncryptionStateEvent());
}

export function describeUnavailableCallEncryption(mode: CallEncryptionMode): string | null {
    switch (mode) {
        case "relay-not-ready":
            return "Calls here are end-to-end encrypted, but this server's voice relay can't do encrypted calls yet.";
        case "browser-unsupported":
            return "Calls here are end-to-end encrypted, and this browser can't take part in them. Try the desktop app or a current browser.";
        default:
            return null;
    }
}

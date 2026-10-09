import { beforeEach, describe, expect, it, vi } from "vitest";

const discovery = vi.hoisted(() => ({
    current: null as null | { features: { participants: boolean; audioState: boolean; e2eeRooms: boolean } },
    init: vi.fn(),
}));

vi.mock("livekit-client", () => ({ isE2EESupported: () => true }));
vi.mock("../../../../src/core/voice/voiceDiscovery", () => ({
    getVoiceDiscovery: () => discovery.current,
    initVoiceDiscovery: discovery.init,
}));

import {
    getCallEncryptionMode,
    resolveCallEncryptionMode,
    usesEncryptedCallRoom,
} from "../../../../src/core/voice/callEncryptionMode";

const room = (encrypted: boolean) => ({ hasEncryptionStateEvent: () => encrypted }) as never;
const client = { getHomeserverUrl: () => "https://matrix.example.org" } as never;
const relay = (e2eeRooms: boolean) => ({ features: { participants: true, audioState: true, e2eeRooms } });

describe("call encryption mode", () => {
    beforeEach(() => {
        discovery.current = null;
        discovery.init.mockReset();
    });

    it("encrypts calls in encrypted rooms when the relay can", () => {
        discovery.current = relay(true);
        expect(getCallEncryptionMode(room(true))).toBe("encrypted");
        expect(getCallEncryptionMode(room(false))).toBe("room-not-encrypted");
        discovery.current = relay(false);
        expect(getCallEncryptionMode(room(true))).toBe("relay-not-ready");
    });

    it("tries voice discovery again before an encrypted call if it hadn't worked", async () => {
        discovery.init.mockImplementation(async () => {
            discovery.current = relay(true);
        });
        await expect(resolveCallEncryptionMode(client, room(true))).resolves.toBe("encrypted");
        expect(discovery.init).toHaveBeenCalledWith("https://matrix.example.org");
    });

    it("doesn't wait on discovery for an unencrypted room's call", async () => {
        await expect(resolveCallEncryptionMode(client, room(false))).resolves.toBe("room-not-encrypted");
        expect(discovery.init).not.toHaveBeenCalled();
    });

    it("lists an encrypted room's call from the encrypted call room, whatever discovery says", () => {
        expect(usesEncryptedCallRoom(room(true))).toBe(true);
        expect(usesEncryptedCallRoom(room(false))).toBe(false);
    });
});

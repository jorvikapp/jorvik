import { afterEach, describe, expect, it, vi } from "vitest";

import {
    clearVoiceDiscovery,
    getVoiceDiscovery,
    initVoiceDiscovery,
    setVoiceDiscoveryFallback,
} from "../../../../src/core/voice/voiceDiscovery";

const JORVIK_DISCOVERY = {
    ok: true,
    apiBaseUrl: "https://matrix.jorvik.app/voice",
    livekitWsUrl: "wss://matrix.jorvik.app/livekit/",
    features: { participants: true, audioState: true, e2eeRooms: true, openidAuth: true },
};

/** Only matrix.jorvik.app runs a voice service; every other address 404s. */
function onlyJorvikHasVoice(): string[] {
    const asked: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            asked.push(url);
            const found = url === "https://matrix.jorvik.app/voice/discovery";
            return { ok: found, json: async () => (found ? JORVIK_DISCOVERY : {}) };
        }),
    );
    return asked;
}

afterEach(() => {
    clearVoiceDiscovery();
    setVoiceDiscoveryFallback(null);
    vi.unstubAllGlobals();
});

describe("voice discovery", () => {
    it("finds the voice service of the user's own homeserver", async () => {
        const asked = onlyJorvikHasVoice();
        setVoiceDiscoveryFallback("https://matrix.jorvik.app");
        await initVoiceDiscovery("https://matrix.jorvik.app");
        expect(getVoiceDiscovery()?.apiBaseUrl).toBe("https://matrix.jorvik.app/voice");
        expect(asked.filter((url) => url.endsWith("/voice/discovery"))).toHaveLength(1);
    });

    it("uses the app's own voice service for someone whose homeserver runs none", async () => {
        const asked = onlyJorvikHasVoice();
        setVoiceDiscoveryFallback("https://matrix.jorvik.app");
        await initVoiceDiscovery("https://matrix-client.matrix.org");
        expect(getVoiceDiscovery()?.features.e2eeRooms).toBe(true);
        expect(asked).toContain("https://matrix-client.matrix.org/voice/discovery");
        expect(asked).toContain("https://matrix.jorvik.app/voice/discovery");
    });

    it("finds nothing without a fallback when the homeserver runs no voice service", async () => {
        onlyJorvikHasVoice();
        await initVoiceDiscovery("https://matrix-client.matrix.org");
        expect(getVoiceDiscovery()).toBeNull();
    });
});

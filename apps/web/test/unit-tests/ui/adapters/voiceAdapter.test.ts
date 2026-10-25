import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    fetchLiveKitToken,
    fetchVoiceParticipants,
    isVoiceFeatureEnabled,
} from "../../../../src/ui/adapters/voiceAdapter";

const TOKEN_RESPONSE = {
    token: "jwt",
    wsUrl: "wss://lk.example",
    livekitRoom: "room-1",
    expiresAt: "2026-01-01T00:00:00.000Z",
};

const OPENID_HEADERS = { "X-Matrix-OpenID-Token": "openid-1", "X-Matrix-Server-Name": "matrix.example.com" };

function makeClient(overrides: Record<string, unknown> = {}) {
    let issued = 0;
    return {
        getAccessToken: vi.fn(() => "syt_secret"),
        getOpenIdToken: vi.fn(async () => ({
            access_token: `openid-${++issued}`,
            token_type: "Bearer",
            matrix_server_name: "matrix.example.com",
            expires_in: 3600,
        })),
        getDeviceId: () => "DEVICE1",
        getHomeserverUrl: () => "https://matrix.example.com/",
        ...overrides,
    };
}

function respond(status: number, body: unknown) {
    const response = {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        clone: () => response,
    };
    return response;
}

describe("voiceAdapter", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("enables voice by default unless explicitly disabled", () => {
        expect(isVoiceFeatureEnabled({ voice_enabled: true } as any)).toBe(true);
        expect(isVoiceFeatureEnabled({ voice_enabled: false } as any)).toBe(false);
        expect(isVoiceFeatureEnabled(null)).toBe(true);
    });

    it("fetchLiveKitToken proves who's asking with an OpenID token and names the device, never sending the access token", async () => {
        const fetchMock = vi.fn(async () => respond(200, TOKEN_RESPONSE));
        globalThis.fetch = fetchMock as any;
        const client = makeClient();

        const result = await fetchLiveKitToken(client as any, null, "!room:example.org", { e2ee: true });

        expect(result.token).toBe("jwt");
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://matrix.example.com/voice/livekit/token");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ "Content-Type": "application/json", ...OPENID_HEADERS });
        expect(init.body).toBe(JSON.stringify({ matrixRoomId: "!room:example.org", e2ee: true, deviceId: "DEVICE1" }));
        expect(client.getAccessToken).not.toHaveBeenCalled();
    });

    it("fetchLiveKitToken uses the app's voice service before guessing from the homeserver's address", async () => {
        const fetchMock = vi.fn(async () => respond(200, TOKEN_RESPONSE));
        globalThis.fetch = fetchMock as any;

        await fetchLiveKitToken(makeClient() as any, { voice_service_url: "https://voice.example///" } as any, "!room:example.org");
        await fetchLiveKitToken(makeClient({ getHomeserverUrl: undefined }) as any, { voice_service_url: "https://voice.example" } as any, "!room:example.org");

        expect(fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([
            "https://voice.example/voice/livekit/token",
            "https://voice.example/voice/livekit/token",
        ]);
    });

    it("fetchLiveKitToken fails when discovery/home URL/config are all unavailable", async () => {
        await expect(fetchLiveKitToken(makeClient({ getHomeserverUrl: undefined }) as any, null, "!room:example.org")).rejects.toThrow(
            "Voice service unavailable: discovery failed and homeserver URL is unavailable.",
        );
    });

    it("fetchLiveKitToken fails when the homeserver won't give an OpenID token", async () => {
        globalThis.fetch = vi.fn() as any;
        const client = makeClient({ getOpenIdToken: vi.fn(async () => Promise.reject(new Error("M_FORBIDDEN"))) });
        await expect(fetchLiveKitToken(client as any, null, "!room:example.org")).rejects.toThrow("M_FORBIDDEN");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("asks the homeserver for one OpenID token and reuses it, and gets a new one once when the relay refuses it", async () => {
        const client = makeClient();
        const fetchMock = vi.fn(async () => respond(200, TOKEN_RESPONSE));
        globalThis.fetch = fetchMock as any;
        await fetchLiveKitToken(client as any, null, "!room:example.org");
        await fetchVoiceParticipants(client as any, null, "!room:example.org");
        expect(client.getOpenIdToken).toHaveBeenCalledTimes(1);

        fetchMock
            .mockImplementationOnce(async () => respond(401, { error: "That OpenID token isn't valid.", error_code: "invalid_openid_token" }))
            .mockImplementationOnce(async () => respond(200, TOKEN_RESPONSE));
        await fetchLiveKitToken(client as any, null, "!room:example.org");
        expect(client.getOpenIdToken).toHaveBeenCalledTimes(2);
        const retried = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
        expect((retried[1].headers as Record<string, string>)["X-Matrix-OpenID-Token"]).toBe("openid-2");
    });

    it("asks for a new OpenID token when the kept one is about to run out", async () => {
        globalThis.fetch = vi.fn(async () => respond(200, TOKEN_RESPONSE)) as any;
        const client = makeClient();
        client.getOpenIdToken.mockImplementation(async () => ({
            access_token: "short-lived",
            token_type: "Bearer",
            matrix_server_name: "matrix.example.com",
            expires_in: 120,
        }));
        await fetchLiveKitToken(client as any, null, "!room:example.org");
        await fetchLiveKitToken(client as any, null, "!room:example.org");
        expect(client.getOpenIdToken).toHaveBeenCalledTimes(3);
    });

    it("fetchLiveKitToken returns backend error message for non-ok response", async () => {
        globalThis.fetch = vi.fn(async () => respond(403, { error: "forbidden" })) as any;
        await expect(fetchLiveKitToken(makeClient() as any, null, "!room:example.org")).rejects.toThrow(
            "Unable to fetch LiveKit token: forbidden",
        );
    });

    it("fetchLiveKitToken falls back to HTTP status when error body is unavailable", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error("invalid-json");
            },
        })) as any;
        await expect(fetchLiveKitToken(makeClient() as any, null, "!room:example.org")).rejects.toThrow(
            "Unable to fetch LiveKit token: HTTP 500",
        );
    });

    it("fetchVoiceParticipants sends GET request with encoded matrixRoomId", async () => {
        const fetchMock = vi.fn(async () =>
            respond(200, { matrixRoomId: "!room:example.org", participants: [{ identity: "@alice:example.org" }], count: 1 }),
        );
        globalThis.fetch = fetchMock as any;

        const result = await fetchVoiceParticipants(makeClient() as any, null, "!room/with space:example.org");

        expect(result.count).toBe(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(
            "https://matrix.example.com/voice/livekit/participants?matrixRoomId=!room%2Fwith%20space%3Aexample.org",
        );
        expect(init.method).toBe("GET");
        expect(init.headers).toEqual(OPENID_HEADERS);
    });

    it("fetchVoiceParticipants reports backend errors", async () => {
        globalThis.fetch = vi.fn(async () => respond(429, { error: "rate_limited" })) as any;
        await expect(fetchVoiceParticipants(makeClient() as any, null, "!room:example.org")).rejects.toThrow(
            "Unable to fetch voice participants: rate_limited",
        );
    });
});

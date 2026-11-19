// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpApiEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientManager } from "../../../../src/core/client/MatrixClientManager";
import type { LegacyTokenRefreshFunction } from "../../../../src/core/client/legacyTokenRefresh";

/**
 * The whole chain with the real SDK client: a Synapse-style session whose access token has expired keeps working
 * through LegacyTokenKeeper, and without it matrix-js-sdk 45 signs the session out (why the keeper exists).
 */
const HS = "https://matrix.example";
const JSON_HEADERS = { "Content-Type": "application/json" }; // as Synapse sends; the SDK reads errcodes only from JSON
const creds = {
    homeserverUrl: HS,
    userId: "@ann:matrix.example",
    deviceId: "DEV",
    accessToken: "expired-token",
    refreshToken: "rt-0",
};

function fakeHomeserver(valid: { token: string }) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization");
        const url = String(input);
        if (!url.includes("/account/whoami")) return new Response("{}", { status: 404 });
        if (auth !== `Bearer ${valid.token}`) {
            return new Response(JSON.stringify({ errcode: "M_UNKNOWN_TOKEN", error: "expired", soft_logout: true }), {
                status: 401,
                headers: JSON_HEADERS,
            });
        }
        return new Response(JSON.stringify({ user_id: creds.userId, device_id: "DEV" }), {
            status: 200,
            headers: JSON_HEADERS,
        });
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("session token refresh with the real SDK client", () => {
    it("refreshes an expired access token and keeps the session", async () => {
        const valid = { token: "fresh-token" };
        vi.stubGlobal("fetch", fakeHomeserver(valid));
        const refresh: LegacyTokenRefreshFunction = vi.fn(async () => ({
            accessToken: "fresh-token",
            refreshToken: "rt-1",
        }));
        const manager = new MatrixClientManager();
        manager.replaceUsingCreds({ ...creds }, refresh);
        const client = manager.safeGet();
        const loggedOut = vi.fn();
        client.on(HttpApiEvent.SessionLoggedOut, loggedOut);

        const me = await client.whoami();

        expect(me.user_id).toBe(creds.userId);
        expect(refresh).toHaveBeenCalledWith("rt-0");
        expect(client.getAccessToken()).toBe("fresh-token");
        expect(loggedOut).not.toHaveBeenCalled();
    });

    it("without the keeper, the SDK ends the session on the first expired token", async () => {
        vi.stubGlobal("fetch", fakeHomeserver({ token: "fresh-token" }));
        const manager = new MatrixClientManager();
        manager.replaceUsingCreds({ ...creds }); // no refresh function: what the SDK alone would do
        const client = manager.safeGet();
        const loggedOut = vi.fn();
        client.on(HttpApiEvent.SessionLoggedOut, loggedOut);

        await expect(client.whoami()).rejects.toMatchObject({ errcode: "M_UNKNOWN_TOKEN" });
        expect(loggedOut).toHaveBeenCalled();
    });
});

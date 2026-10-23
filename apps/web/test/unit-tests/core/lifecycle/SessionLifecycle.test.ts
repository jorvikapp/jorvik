import { EventEmitter } from "events";
import { HttpApiEvent, MatrixError } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

import { SessionLifecycle } from "../../../../src/core/lifecycle/SessionLifecycle";

function setup() {
    const client = Object.assign(new EventEmitter(), {
        isGuest: () => false,
        getUserId: () => "@me:example.org",
        getDeviceId: () => "DEVICE",
        logout: vi.fn(async () => ({})),
    });
    const clientManager = {
        replaceUsingCreds: vi.fn(),
        safeGet: () => client,
        get: () => client,
        assign: vi.fn(async () => ({})),
        stop: vi.fn(),
    };
    const platform = {
        getPickleKey: async () => null,
        createPickleKey: async () => null,
        destroyPickleKey: vi.fn(async () => undefined),
    };
    const session = new SessionLifecycle({ platform: platform as never, clientManager: clientManager as never });
    return { client, clientManager, platform, session };
}

async function signIn(session: SessionLifecycle): Promise<void> {
    await session.setLoggedIn(
        { homeserverUrl: "https://example.org", userId: "@me:example.org", deviceId: "DEVICE", accessToken: "token" },
        { persistSession: false, startSyncing: false },
    );
}

describe("SessionLifecycle", () => {
    it("says when the homeserver has ended the session, every time the SDK reports it", async () => {
        const { client, session } = setup();
        const ended = vi.fn();
        session.onSessionLoggedOut = ended;
        await signIn(session);

        const error = new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "Invalid access token passed." }, 401);
        client.emit(HttpApiEvent.SessionLoggedOut, error);
        client.emit(HttpApiEvent.SessionLoggedOut, error);

        expect(ended).toHaveBeenCalledTimes(2);
    });

    it("only forgets a session the homeserver already ended, without asking it to sign out", async () => {
        const { client, clientManager, platform, session } = setup();
        await signIn(session);

        await session.logout(false, false);

        expect(client.logout).not.toHaveBeenCalled();
        expect(platform.destroyPickleKey).toHaveBeenCalledWith("@me:example.org", "DEVICE");
        expect(clientManager.stop).toHaveBeenCalledWith(true);
    });

    it("still signs out on the homeserver by default", async () => {
        const { client, session } = setup();
        await signIn(session);

        await session.logout(false);

        expect(client.logout).toHaveBeenCalledWith(true);
    });
});

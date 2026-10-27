import { describe, expect, it, vi } from "vitest";

import { afterPageAuth, passwordAuth, probeReauthWays, readReauthChallenge } from "../../../../src/core/auth/reauth";

const client = {
    getFallbackAuthUrl: (stage: string, session: string) => `https://hs.example/_matrix/client/v3/auth/${stage}/fallback/web?session=${session}`,
} as never;

function asked(data: Record<string, unknown>, httpStatus = 401): Error {
    return Object.assign(new Error("UIA"), { httpStatus, data });
}

describe("readReauthChallenge", () => {
    it("offers the password first, then single sign-on on the server's page", () => {
        const challenge = readReauthChallenge(
            client,
            asked({ session: "s1", flows: [{ stages: ["m.login.sso"] }, { stages: ["m.login.password"] }] }),
        );
        expect(challenge).toEqual({
            session: "s1",
            ways: [
                { kind: "password" },
                { kind: "sso", url: "https://hs.example/_matrix/client/v3/auth/m.login.sso/fallback/web?session=s1" },
            ],
        });
    });

    it("takes the older name for single sign-on", () => {
        const challenge = readReauthChallenge(client, asked({ session: "s1", flows: [{ stages: ["org.matrix.login.sso"] }] }));
        expect(challenge?.ways).toEqual([
            { kind: "sso", url: "https://hs.example/_matrix/client/v3/auth/org.matrix.login.sso/fallback/web?session=s1" },
        ]);
    });

    it("approves on the account page where the server says so (Matrix Authentication Service)", () => {
        const url = "https://auth.example/account?action=org.matrix.cross_signing_reset";
        const challenge = readReauthChallenge(
            client,
            asked({
                session: "dummy",
                flows: [{ stages: ["m.oauth"] }, { stages: ["org.matrix.cross_signing_reset"] }],
                params: { "m.oauth": { url }, "org.matrix.cross_signing_reset": { url } },
            }),
        );
        expect(challenge?.ways).toEqual([{ kind: "approve", url }]);
    });

    it("finds nothing it can do in steps it doesn't know or flows of several steps", () => {
        const challenge = readReauthChallenge(
            client,
            asked({ session: "s1", flows: [{ stages: ["m.login.recaptcha"] }, { stages: ["m.login.password", "m.login.email.identity"] }] }),
        );
        expect(challenge).toEqual({ session: "s1", ways: [] });
    });

    it("is null for anything that isn't a request to show it's you", () => {
        expect(readReauthChallenge(client, asked({ errcode: "M_FORBIDDEN" }, 403))).toBeNull();
        // A 401 without flows is a session that ended.
        expect(readReauthChallenge(client, asked({ errcode: "M_UNKNOWN_TOKEN" }))).toBeNull();
        expect(readReauthChallenge(client, new Error("offline"))).toBeNull();
    });

    it("can't use single sign-on without a session to finish it in", () => {
        expect(readReauthChallenge(client, asked({ flows: [{ stages: ["m.login.sso"] }] }))?.ways).toEqual([]);
    });
});

describe("what to send again", () => {
    it("sends the password with the session", () => {
        expect(passwordAuth("@me:x", "pw", "s1")).toEqual({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: "@me:x" },
            password: "pw",
            session: "s1",
        });
    });

    it("sends only the session after single sign-on, and nothing after approving", () => {
        expect(afterPageAuth({ kind: "sso", url: "u" }, "s1")).toEqual({ session: "s1" });
        expect(afterPageAuth({ kind: "approve", url: "u" }, "dummy")).toBeNull();
    });
});

describe("probeReauthWays", () => {
    function probing(result: () => Promise<unknown>) {
        const authedRequest = vi.fn(result);
        return { client: { ...(client as object), http: { authedRequest } } as never, authedRequest };
    }

    it("asks by signing out no sessions", async () => {
        const { client: probe, authedRequest } = probing(async () => {
            throw asked({ session: "s1", flows: [{ stages: ["m.login.sso"] }] });
        });
        expect(await probeReauthWays(probe)).toEqual([
            { kind: "sso", url: "https://hs.example/_matrix/client/v3/auth/m.login.sso/fallback/web?session=s1" },
        ]);
        expect(authedRequest).toHaveBeenCalledWith("POST", "/delete_devices", undefined, { devices: [] });
    });

    it("is null when the server can't say", async () => {
        const { client: probe } = probing(async () => {
            throw asked({ errcode: "M_UNRECOGNIZED" }, 404);
        });
        expect(await probeReauthWays(probe)).toBeNull();
    });

    it("is empty when the server asks for nothing", async () => {
        const { client: probe } = probing(async () => ({}));
        expect(await probeReauthWays(probe)).toEqual([]);
    });
});

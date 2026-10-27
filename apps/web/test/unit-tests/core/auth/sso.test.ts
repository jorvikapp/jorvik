import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    captureSsoReturn,
    consumeSsoReturn,
    type DesktopSsoBridge,
    discoverLoginOptions,
    resetSsoReturnForTests,
    signInWithSsoOnDesktop,
    SSO_PENDING_STORAGE_KEY,
    SSOAction,
    ssoButtonLabel,
    ssoProvidersFromFlows,
    startSsoRedirect,
} from "../../../../src/core/auth/sso";

const HS = "https://hs.example";
const KEYCLOAK = { id: "oidc-keycloak", name: "Keycloak", loginType: "sso" } as const;

beforeEach(() => {
    window.localStorage.clear();
    resetSsoReturnForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("which ways in a server offers", () => {
    it("makes a button for each sign-in provider the server lists", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: RequestInfo | URL) => {
                expect(String(input)).toBe(`${HS}/_matrix/client/v3/login`);
                return new Response(
                    JSON.stringify({
                        flows: [
                            { type: "m.login.sso", identity_providers: [{ id: "oidc-keycloak", name: "Keycloak" }, { id: "oidc-github", name: "GitHub" }] },
                            { type: "m.login.token" },
                        ],
                    }),
                    { status: 200 },
                );
            }),
        );
        expect(await discoverLoginOptions(HS)).toEqual({
            password: false,
            sso: [KEYCLOAK, { id: "oidc-github", name: "GitHub", loginType: "sso" }],
        });
    });

    it("offers one plain button when the server names no provider, and CAS on its own", () => {
        expect(ssoProvidersFromFlows([{ type: "m.login.sso" }, { type: "m.login.password" }])).toEqual([{ name: "", loginType: "sso" }]);
        expect(ssoProvidersFromFlows([{ type: "m.login.cas" }])).toEqual([{ name: "", loginType: "cas" }]);
        // Synapse lists CAS both ways; m.login.sso has the providers.
        expect(ssoProvidersFromFlows([{ type: "m.login.cas" }, { type: "m.login.sso", identity_providers: [{ id: "cas", name: "CAS" }] }])).toEqual([
            { id: "cas", name: "CAS", loginType: "sso" },
        ]);
        expect(ssoProvidersFromFlows([{ type: "m.login.password" }])).toEqual([]);
    });

    it("skips providers it can't send anyone to", () => {
        expect(
            ssoProvidersFromFlows([{ type: "m.login.sso", identity_providers: [{ name: "No id" }, { id: "", name: "Empty" }, { id: "ok", name: " " }] }]),
        ).toEqual([{ id: "ok", name: "ok", loginType: "sso" }]);
    });

    it("words the buttons", () => {
        expect(ssoButtonLabel(KEYCLOAK)).toBe("Continue with Keycloak");
        expect(ssoButtonLabel({ name: "", loginType: "sso" })).toBe("Continue with single sign-on");
    });
});

describe("single sign-on in a browser", () => {
    function startFrom(href: string): { assigned: URL; marker: string } {
        const assign = vi.fn();
        startSsoRedirect(HS, KEYCLOAK, SSOAction.LOGIN, { href, assign });
        const assigned = new URL(assign.mock.calls[0][0] as string);
        const pending = JSON.parse(window.localStorage.getItem(SSO_PENDING_STORAGE_KEY)!) as { marker: string; homeserverUrl: string };
        expect(pending.homeserverUrl).toBe(HS);
        return { assigned, marker: pending.marker };
    }

    it("goes to the provider through the homeserver, coming back to this page with a marker", () => {
        const { assigned, marker } = startFrom("https://chat.example/?old=1#/rooms");
        expect(assigned.origin + assigned.pathname).toBe(`${HS}/_matrix/client/v3/login/sso/redirect/oidc-keycloak`);
        expect(assigned.searchParams.get("redirectUrl")).toBe(`https://chat.example/?jorvik_sso=${marker}`);
        expect(assigned.searchParams.get("action")).toBe("login");
        expect(marker).toMatch(/^[0-9a-f]{32}$/);
    });

    it("takes the token that comes back with the marker, once, and clears the address bar", () => {
        const { marker } = startFrom("https://chat.example/");
        const history = { state: { kept: true }, replaceState: vi.fn() };
        captureSsoReturn({ href: `https://chat.example/?jorvik_sso=${marker}&loginToken=tok&other=2#/x` }, history);

        expect(history.replaceState).toHaveBeenCalledWith({ kept: true }, "", "https://chat.example/?other=2#/x");
        expect(window.localStorage.getItem(SSO_PENDING_STORAGE_KEY)).toBeNull();
        expect(consumeSsoReturn()).toEqual({ homeserverUrl: HS, loginToken: "tok" });
        expect(consumeSsoReturn()).toBeNull();
    });

    it("won't use a token that didn't start in this browser", () => {
        startFrom("https://chat.example/");
        const history = { state: null, replaceState: vi.fn() };
        captureSsoReturn({ href: "https://chat.example/?jorvik_sso=someone-elses&loginToken=theirs" }, history);
        expect(history.replaceState).toHaveBeenCalled();
        expect(consumeSsoReturn()).toEqual({ error: expect.stringContaining("didn't start in this browser") });
    });

    it("won't use a token without the marker, even with a sign-in pending", () => {
        startFrom("https://chat.example/");
        captureSsoReturn({ href: "https://chat.example/?loginToken=planted" }, { state: null, replaceState: vi.fn() });
        expect(consumeSsoReturn()).toEqual({ error: expect.stringContaining("didn't start in this browser") });
    });

    it("won't use a sign-in started long ago", () => {
        const { marker } = startFrom("https://chat.example/");
        captureSsoReturn(
            { href: `https://chat.example/?jorvik_sso=${marker}&loginToken=tok` },
            { state: null, replaceState: vi.fn() },
            Date.now() + 31 * 60_000,
        );
        expect(consumeSsoReturn()).toEqual({ error: expect.any(String) });
    });

    it("leaves an ordinary page load alone", () => {
        const history = { state: null, replaceState: vi.fn() };
        captureSsoReturn({ href: "https://chat.example/?x=1" }, history);
        expect(history.replaceState).not.toHaveBeenCalled();
        expect(consumeSsoReturn()).toBeNull();
    });
});

describe("single sign-on in the desktop app", () => {
    function bridgeWith(result: Awaited<ReturnType<DesktopSsoBridge["ssoWait"]>>) {
        return {
            ssoBegin: vi.fn(async () => "http://127.0.0.1:43210/jorvik?state=abc"),
            ssoWait: vi.fn(async () => result),
            ssoCancel: vi.fn(async () => undefined),
            openExternal: vi.fn(async () => undefined),
        };
    }

    it("opens the provider in the browser, coming back to the app's own address", async () => {
        const bridge = bridgeWith({ loginToken: "tok" });
        const opened: string[] = [];
        expect(await signInWithSsoOnDesktop(bridge, HS, KEYCLOAK, SSOAction.REGISTER, (url) => opened.push(url))).toBe("tok");

        const url = new URL(bridge.openExternal.mock.calls[0][0] as string);
        expect(url.pathname).toBe("/_matrix/client/v3/login/sso/redirect/oidc-keycloak");
        expect(url.searchParams.get("redirectUrl")).toBe("http://127.0.0.1:43210/jorvik?state=abc");
        expect(url.searchParams.get("action")).toBe("register");
        expect(opened).toEqual([url.toString()]);
    });

    it("gives nothing when cancelled, and says so when the wait ran out", async () => {
        expect(await signInWithSsoOnDesktop(bridgeWith({ cancelled: true }), HS, KEYCLOAK, SSOAction.LOGIN, () => undefined)).toBeNull();
        await expect(signInWithSsoOnDesktop(bridgeWith({ timedOut: true }), HS, KEYCLOAK, SSOAction.LOGIN, () => undefined)).rejects.toThrow(
            "took too long",
        );
    });
});

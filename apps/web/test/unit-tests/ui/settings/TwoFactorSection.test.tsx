import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSetupStatus } from "../../../../src/core/auth/twoFactorSetup";
import { SdkConfig } from "../../../../src/core/config/SdkConfig";
import { setupFailureText, TwoFactorSection } from "../../../../src/ui/settings/user/tabs/TwoFactorSection";

let container: HTMLDivElement;
let root: Root;
const ACCOUNT = "https://account.jorvik.app/if/user/#/settings";
const REQUESTS = "https://account.jorvik.app/jorvik/two-factor";
const realFetch = globalThis.fetch;

/** What the request service answers about this person, and every request the card made. */
let status: Record<string, unknown> = { state: "none" };
let requests: { method: string; url: string; token: string | null }[] = [];

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    status = { state: "none" };
    requests = [];
    setPassword.mockReset();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        requests.push({ method: init?.method ?? "GET", url, token: headers["X-Matrix-OpenID-Token"] ?? null });
        const asked = url.endsWith("/request") || url.endsWith("/off");
        return new Response(JSON.stringify(asked ? { state: "queued" } : status), { status: asked ? 202 : 200 });
    }) as typeof fetch;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    SdkConfig.put({});
    globalThis.fetch = realFetch;
    vi.useRealTimers();
});

/** What the server offers for "show it's you" right now (after turning off, the account has a password again). */
let stagesNow: string[] | null = null;
const setPassword = vi.fn();

/** A client whose "sign out no sessions" request is answered the way the server would. */
function clientAsking(stages: string[] | null, emails: string[] = []) {
    stagesNow = stages;
    return {
        getFallbackAuthUrl: (stage: string, session: string) => `https://matrix.example/_matrix/client/v3/auth/${stage}/fallback/web?session=${session}`,
        http: {
            authedRequest: async () => {
                if (stagesNow === null) {
                    return {};
                }
                throw Object.assign(new Error("401"), { httpStatus: 401, data: { session: "s1", flows: stagesNow.map((stage) => ({ stages: [stage] })) } });
            },
        },
        getThreePids: async () => ({ threepids: emails.map((address) => ({ medium: "email", address })) }),
        getOpenIdToken: async () => ({ access_token: "openid-token", matrix_server_name: "matrix.example", expires_in: 3600, token_type: "Bearer" }),
        setPassword,
    } as never;
}

/** Types into the field whose label is exactly this, the way React sees typing. */
async function type(label: string, value: string): Promise<void> {
    const field = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label)?.querySelector("input");
    expect(field, `a "${label}" field`).toBeTruthy();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
        setValue.call(field, value);
        field!.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 4; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    });
}

async function show(stages: string[] | null, emails: string[] = []): Promise<void> {
    await act(async () => {
        root.render(<TwoFactorSection client={clientAsking(stages, emails)} />);
    });
    await settle();
}

function button(text: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
}

async function click(text: string): Promise<void> {
    const target = button(text);
    expect(target, `a "${text}" button`).toBeTruthy();
    await act(async () => target!.click());
    await settle();
}

describe("TwoFactorSection", () => {
    it("says it's on, with the link to manage codes and passkeys, when only the Jorvik account can confirm", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT });
        await show(["m.login.sso"]);
        expect(container.textContent).toContain("Two-factor sign-in");
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("On");
        const link = container.querySelector("a") as HTMLAnchorElement;
        expect(link.textContent).toBe("Manage codes and passkeys");
        expect(link.getAttribute("href")).toBe(ACCOUNT);
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
        expect(container.textContent).toContain("To turn it off, ask a server admin.");
    });

    it("says it's off, and how to get it, while the account still has a password", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT });
        await show(["m.login.password", "m.login.sso"]);
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("Off");
        expect(container.textContent).toContain("Ask a server admin to turn on two-factor sign-in");
        expect(container.querySelector("a")).toBeNull();
        expect(button("Turn on")).toBeUndefined();
    });

    it("shows nothing on servers that don't offer it, or when the server can't say", async () => {
        await show(["m.login.sso"]);
        expect(container.textContent).toBe("");
        SdkConfig.put({ account_management_url: ACCOUNT });
        await show(null);
        expect(container.textContent).toBe("");
    });

    it("offers to turn it on here when the server takes requests", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.password", "m.login.sso"], ["rhea@example.org"]);
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("Off");
        expect(button("Turn on")).toBeTruthy();
        expect(container.textContent).not.toContain("Ask a server admin to turn on");
        expect(requests).toEqual([{ method: "GET", url: `${REQUESTS}/status`, token: "openid-token" }]);
    });

    it("says where the link goes, sends it, and then says to check that email", async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.password", "m.login.sso"], ["rhea@example.org"]);
        await click("Turn on");
        expect(container.textContent).toContain("We'll email a setup link to rhea@example.org");
        expect(container.textContent).toContain("You can keep the one you use now.");
        await click("Send setup email");
        expect(requests.at(-1)).toEqual({ method: "POST", url: `${REQUESTS}/request`, token: "openid-token" });
        expect(container.textContent).toContain("Sending your setup link...");
        status = { state: "email_sent", email: "r***@example.org" };
        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        await settle();
        expect(container.textContent).toContain("Check your email: we sent a setup link to rhea@example.org");
        expect(button("Send it again")).toBeTruthy();
    });

    it("can go back without sending anything", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.password", "m.login.sso"], ["rhea@example.org"]);
        await click("Turn on");
        await click("Cancel");
        expect(button("Turn on")).toBeTruthy();
        expect(requests.filter((request) => request.method === "POST")).toEqual([]);
    });

    it("picks up a setup email sent earlier", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        status = { state: "email_sent", email: "r***@example.org" };
        await show(["m.login.password", "m.login.sso"], ["rhea@example.org"]);
        expect(container.textContent).toContain("Check your email: we sent a setup link to r***@example.org");
    });

    it("says why when the account has no email to send the link to", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.password", "m.login.sso"], []);
        await click("Turn on");
        expect(container.textContent).toContain("Setup needs an email address on your account");
        expect(requests.filter((request) => request.method === "POST")).toEqual([]);
    });

    it("offers to turn it off here when the server takes requests", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.sso"]);
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("On");
        expect(button("Turn off")).toBeTruthy();
        expect(container.textContent).not.toContain("ask a server admin");
    });

    it("turns off: a password to sign in with, confirmed with the Jorvik account, then the server tidies up", async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.sso"]);
        await click("Turn off");
        expect(container.textContent).toContain("Turning it off means your password alone signs you in again");
        await type("Password", "new-pass-1");
        await type("Password again", "new-pass-1");
        // Synapse asks the account to show it's them, and only the Jorvik account can.
        setPassword.mockRejectedValueOnce(
            Object.assign(new Error("401"), { httpStatus: 401, data: { session: "s2", flows: [{ stages: ["m.login.sso"] }] } }),
        );
        await click("Turn off");
        expect(setPassword).toHaveBeenNthCalledWith(1, undefined, "new-pass-1", false);
        expect(container.textContent).toContain("Confirm it's you with your Jorvik account: your password, then a code.");
        const opened = vi.spyOn(window, "open").mockReturnValue(window);
        await click("Continue with Jorvik account");
        expect(opened).toHaveBeenCalledWith("https://matrix.example/_matrix/client/v3/auth/m.login.sso/fallback/web?session=s2", "_blank");
        // Synapse's "Confirmed" page tells the window that opened it; the card then sets the password by itself.
        setPassword.mockResolvedValueOnce({});
        await act(async () => {
            window.dispatchEvent(new MessageEvent("message", { data: "authDone", source: window }));
        });
        await settle();
        expect(setPassword).toHaveBeenNthCalledWith(2, { session: "s2" }, "new-pass-1", false);
        expect(requests.at(-1)).toEqual({ method: "POST", url: `${REQUESTS}/off`, token: "openid-token" });
        expect(container.textContent).toContain("Turning it off...");
        // The server has tidied up and the account has its password again.
        status = { state: "off" };
        stagesNow = ["m.login.password", "m.login.sso"];
        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        await settle();
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("Off");
        expect(button("Turn on")).toBeTruthy();
        opened.mockRestore();
    });

    it("won't turn it off when the two passwords differ", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT, two_factor_request_url: REQUESTS });
        await show(["m.login.sso"]);
        await click("Turn off");
        await type("Password", "new-pass-1");
        await type("Password again", "new-pass-2");
        await click("Turn off");
        expect(container.textContent).toContain("The two passwords don't match.");
        expect(setPassword).not.toHaveBeenCalled();
        await click("Cancel");
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("On");
    });

    it("explains each reason the server gives", () => {
        expect(setupFailureText("name_taken")).toContain("Ask a server admin to turn it on for you");
        expect(setupFailureText("no_email")).toContain("Ask a server admin to add one");
        expect(setupFailureText("something_new")).toContain("Try again in a while");
    });

    it("only believes well-formed answers from the request service", () => {
        expect(parseSetupStatus({ state: "email_sent", email: "r***@example.org" })).toEqual({ state: "email_sent", email: "r***@example.org" });
        expect(parseSetupStatus({ state: "failed", reason: "no_email" })).toEqual({ state: "failed", reason: "no_email" });
        expect(parseSetupStatus({ state: "failed", reason: "<b>bad</b>" })).toEqual({ state: "failed" });
        expect(parseSetupStatus({ state: "off" })).toEqual({ state: "off" });
        expect(parseSetupStatus({ state: "hacked" })).toEqual({ state: "none" });
        expect(parseSetupStatus(null)).toEqual({ state: "none" });
    });
});

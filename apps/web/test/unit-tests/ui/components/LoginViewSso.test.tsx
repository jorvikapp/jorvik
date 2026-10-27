import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startSsoRedirect = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/core/auth/sso", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../src/core/auth/sso")>()),
    startSsoRedirect,
}));

import { LoginView } from "../../../../src/ui/components/LoginView";

const HS = "https://matrix.example.org";
const KEYCLOAK = { id: "oidc-keycloak", name: "Keycloak", loginType: "sso" };
const SSO_FLOW = { type: "m.login.sso", identity_providers: [{ id: "oidc-keycloak", name: "Keycloak" }] };

let container: HTMLDivElement;
let root: Root;
let flows: unknown[] | null;
let onLoginWithSsoToken: ReturnType<typeof vi.fn>;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    startSsoRedirect.mockReset();
    onLoginWithSsoToken = vi.fn().mockResolvedValue(undefined);
    flows = null;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
            if (String(input) === `${HS}/_matrix/client/v3/login` && flows) {
                return new Response(JSON.stringify({ flows }), { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    delete window.heorotDesktop;
});

async function render(): Promise<void> {
    await act(async () => {
        root.render(
            <LoginView
                defaultHomeserver={HS}
                disableHomeserverInput={false}
                loading={false}
                error={null}
                onLogin={async () => undefined}
                onLoginWithCredentials={async () => undefined}
                onLoginWithSsoToken={onLoginWithSsoToken}
            />,
        );
    });
    // The server's answer about how it signs people in.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

async function click(text: string): Promise<void> {
    const button = buttonNamed(text);
    if (!button) throw new Error(`no button ${text}`);
    await act(async () => {
        button.click();
    });
}

describe("LoginView single sign-on", () => {
    it("offers the server's sign-in providers next to the password form", async () => {
        flows = [SSO_FLOW, { type: "m.login.password" }];
        await render();

        expect(buttonNamed("Continue with Keycloak")).toBeDefined();
        expect(container.querySelector(".login-divider")?.textContent).toBe("or");
        expect(container.querySelector('input[placeholder="********"]')).not.toBeNull();
        expect(buttonNamed("Forgot password?")).toBeDefined();
    });

    it("shows only single sign-on where the server takes no passwords, and goes there", async () => {
        flows = [SSO_FLOW, { type: "m.login.token" }];
        await render();

        expect(container.querySelector('input[placeholder="********"]')).toBeNull();
        expect(container.querySelector("form button[type=submit]")).toBeNull();
        expect(buttonNamed("Forgot password?")).toBeUndefined();
        await click("Continue with Keycloak");
        expect(startSsoRedirect).toHaveBeenCalledWith(HS, KEYCLOAK, "login");
    });

    it("keeps the password form while the server can't say", async () => {
        await render();
        expect(container.querySelector(".login-sso")).toBeNull();
        expect(container.querySelector('input[placeholder="********"]')).not.toBeNull();
    });

    it("makes the account on first sign-in where the server takes no passwords", async () => {
        flows = [SSO_FLOW];
        await render();
        await click("Register");

        expect(container.textContent).toContain("makes your account the first time you sign in");
        expect(container.querySelector('input[placeholder="At least 8 characters"]')).toBeNull();
        await click("Continue with Keycloak");
        expect(startSsoRedirect).toHaveBeenCalledWith(HS, KEYCLOAK, "register");
    });

    describe("in the desktop app", () => {
        function desktop(): { wait: (result: unknown) => void; bridge: Record<string, ReturnType<typeof vi.fn>> } {
            let finish: (result: unknown) => void = () => undefined;
            const bridge = {
                ssoBegin: vi.fn(async () => "http://127.0.0.1:43210/jorvik?state=abc"),
                ssoWait: vi.fn(() => new Promise((resolve) => (finish = resolve))),
                ssoCancel: vi.fn(async () => finish({ cancelled: true })),
                openExternal: vi.fn(async () => undefined),
            };
            window.heorotDesktop = bridge as never;
            return { wait: (result) => finish(result), bridge };
        }

        it("waits for the browser, then signs in with the token it brought back", async () => {
            flows = [SSO_FLOW];
            const { wait, bridge } = desktop();
            await render();
            await click("Continue with Keycloak");

            expect(startSsoRedirect).not.toHaveBeenCalled();
            expect(container.textContent).toContain("Continue in your browser");
            const opened = new URL(bridge.openExternal.mock.calls[0][0] as string);
            expect(opened.searchParams.get("redirectUrl")).toBe("http://127.0.0.1:43210/jorvik?state=abc");

            await click("Open the page again");
            expect(bridge.openExternal).toHaveBeenCalledTimes(2);

            await act(async () => {
                wait({ loginToken: "tok" });
            });
            expect(onLoginWithSsoToken).toHaveBeenCalledWith(HS, "tok");
        });

        it("stops waiting on Cancel", async () => {
            flows = [SSO_FLOW];
            const { bridge } = desktop();
            await render();
            await click("Continue with Keycloak");
            await click("Cancel");

            expect(bridge.ssoCancel).toHaveBeenCalled();
            expect(container.textContent).not.toContain("Continue in your browser");
            expect(buttonNamed("Continue with Keycloak")?.disabled).toBe(false);
            expect(onLoginWithSsoToken).not.toHaveBeenCalled();
        });

        it("says so when the browser took too long", async () => {
            flows = [SSO_FLOW];
            const { wait } = desktop();
            await render();
            await click("Continue with Keycloak");
            await act(async () => {
                wait({ timedOut: true });
            });

            expect(container.querySelector(".login-error")?.textContent).toContain("took too long");
            expect(onLoginWithSsoToken).not.toHaveBeenCalled();
        });
    });
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { encodeRecoveryKey } from "matrix-js-sdk/src/crypto-api/recovery-key";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResetIdentityAuth } from "../../../../src/core/crypto/crossSigning";
import { DeviceVerificationView } from "../../../../src/ui/components/DeviceVerificationView";

const RECOVERY_KEY = encodeRecoveryKey(new Uint8Array(32).fill(7))!;
const SSO_PAGE = "https://hs.example/_matrix/client/v3/auth/m.login.sso/fallback/web?session=probe";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});

/** A server whose "sign out no sessions" request asks for these steps. */
function clientAsking(stages: string[]) {
    return {
        on: vi.fn(),
        off: vi.fn(),
        getFallbackAuthUrl: (stage: string, session: string) => `https://hs.example/_matrix/client/v3/auth/${stage}/fallback/web?session=${session}`,
        http: {
            authedRequest: vi.fn(async () => {
                throw Object.assign(new Error("UIA"), {
                    httpStatus: 401,
                    data: { session: "probe", flows: stages.map((stage) => ({ stages: [stage] })) },
                });
            }),
        },
    } as never;
}

async function openReset(client: never, onResetIdentity: (auth: ResetIdentityAuth, key: string) => Promise<void>): Promise<void> {
    await act(async () => {
        root.render(
            <DeviceVerificationView
                client={client}
                error={null}
                localDeviceVerified={false}
                canSkip
                onRefreshStatus={async () => undefined}
                onSkip={async () => undefined}
                onResetIdentity={onResetIdentity}
                onLogout={async () => undefined}
            />,
        );
    });
    await click("Can't verify? Reset your identity");
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

async function type(label: string, value: string): Promise<void> {
    const input = Array.from(container.querySelectorAll("label")).find((candidate) => candidate.textContent?.startsWith(label))
        ?.querySelector("input");
    if (!input) throw new Error(`no field ${label}`);
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("DeviceVerificationView reset", () => {
    it("asks for the password where the account has one", async () => {
        const onResetIdentity = vi.fn(async () => undefined);
        await openReset(clientAsking(["m.login.password"]), onResetIdentity);

        await type("Security key", RECOVERY_KEY);
        expect(buttonNamed("Reset identity")?.disabled).toBe(true);
        await type("Account password", "pw");
        await click("Reset identity");

        expect(onResetIdentity).toHaveBeenCalledWith(expect.objectContaining({ password: "pw" }), RECOVERY_KEY);
    });

    it("confirms on the server's page where the account signs in with single sign-on", async () => {
        const opened = vi.fn(() => null);
        vi.stubGlobal("open", opened);
        let finished = false;
        const onResetIdentity = vi.fn(async (auth: ResetIdentityAuth) => {
            await auth.confirmOnPage!({ kind: "sso", url: SSO_PAGE });
            finished = true;
        });
        await openReset(clientAsking(["m.login.sso"]), onResetIdentity);

        expect(container.textContent).not.toContain("Account password");
        expect(container.textContent).toContain("confirm it's you on its own page");
        await type("Security key", RECOVERY_KEY);
        await click("Reset identity");

        expect(onResetIdentity.mock.calls[0][0].password).toBeUndefined();
        expect(container.textContent).toContain("To finish the reset, confirm it's you with single sign-on");
        expect(buttonNamed("Finish reset")?.disabled).toBe(true);
        await click("Continue with single sign-on");
        expect(opened).toHaveBeenCalledWith(SSO_PAGE, "_blank");
        await click("Finish reset");

        expect(finished).toBe(true);
        expect(container.textContent).not.toContain("To finish the reset");
    });

    it("stops the reset when asked, and says it didn't finish", async () => {
        const onResetIdentity = vi.fn(async (auth: ResetIdentityAuth) => {
            await auth.confirmOnPage!({ kind: "sso", url: SSO_PAGE });
        });
        await openReset(clientAsking(["m.login.sso"]), onResetIdentity);
        await type("Security key", RECOVERY_KEY);
        await click("Reset identity");
        await click("Stop");

        expect(container.querySelector(".login-error")?.textContent).toContain("The reset didn't finish");
    });
});

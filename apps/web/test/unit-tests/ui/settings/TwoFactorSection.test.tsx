import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SdkConfig } from "../../../../src/core/config/SdkConfig";
import { TwoFactorSection } from "../../../../src/ui/settings/user/tabs/TwoFactorSection";

let container: HTMLDivElement;
let root: Root;
const ACCOUNT = "https://account.jorvik.app/if/user/#/settings";

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    SdkConfig.put({});
});

/** A client whose "sign out no sessions" request is answered the way the server would. */
function clientAsking(stages: string[] | null) {
    return {
        getFallbackAuthUrl: (stage: string, session: string) => `https://matrix.example/_matrix/client/v3/auth/${stage}/fallback/web?session=${session}`,
        http: {
            authedRequest: async () => {
                if (stages === null) {
                    return {};
                }
                throw Object.assign(new Error("401"), { httpStatus: 401, data: { session: "s1", flows: stages.map((stage) => ({ stages: [stage] })) } });
            },
        },
    } as never;
}

async function show(stages: string[] | null): Promise<void> {
    await act(async () => {
        root.render(<TwoFactorSection client={clientAsking(stages)} />);
    });
    await act(async () => {
        await Promise.resolve();
    });
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
    });

    it("says it's off, and how to get it, while the account still has a password", async () => {
        SdkConfig.put({ account_management_url: ACCOUNT });
        await show(["m.login.password", "m.login.sso"]);
        expect(container.querySelector(".settings-role-badge")?.textContent).toBe("Off");
        expect(container.textContent).toContain("Ask a server admin to turn on two-factor sign-in");
        expect(container.querySelector("a")).toBeNull();
    });

    it("shows nothing on servers that don't offer it, or when the server can't say", async () => {
        await show(["m.login.sso"]);
        expect(container.textContent).toBe("");
        SdkConfig.put({ account_management_url: ACCOUNT });
        await show(null);
        expect(container.textContent).toBe("");
    });
});

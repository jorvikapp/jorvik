import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MatrixError } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegistrationInteractiveAuth } from "../../../../src/ui/components/auth/RegistrationInteractiveAuth";

// The SDK's interactive auth uses it; Node 20 lacks it (browsers and Electron have it).
(Promise as unknown as { withResolvers?: unknown }).withResolvers ??= function withResolvers<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const FLOWS = [{ stages: ["m.login.email.identity"] }];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** Synapse's /register as an email-verified sign-up sees it. */
function fakeServer(emailCheck: { errcode: string; error: string } = { errcode: "M_UNAUTHORIZED", error: "Unable to get validated threepid" }) {
    const server = { linkClicked: false, emailsSent: 0 };
    const client = {
        generateClientSecret: () => "secret",
        doesServerRequireIdServerParam: async () => false,
        getHomeserverUrl: () => "https://hs.example",
        getIdentityServerUrl: () => undefined,
        requestRegisterEmailToken: vi.fn(async () => {
            server.emailsSent++;
            return { sid: "sid-1" };
        }),
        registerRequest: vi.fn(async (params: { auth?: { type?: string } }) => {
            const uia = { flows: FLOWS, session: "uia-1", params: {}, completed: [] as string[] };
            if (params.auth?.type === "m.login.email.identity") {
                if (server.linkClicked) {
                    return { user_id: "@new:hs.example", access_token: "token", device_id: "DEVICE" };
                }
                throw new MatrixError({ ...uia, ...emailCheck }, 401);
            }
            throw new MatrixError(uia, 401);
        }),
    };
    return { client, server };
}

async function settle(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
}

const button = (label: string): HTMLButtonElement =>
    [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
const redText = (): string[] => [...container.querySelectorAll(".login-error")].map((node) => node.textContent ?? "");

function renderSignUp(client: unknown, onCompleted = vi.fn(async () => undefined)) {
    act(() => {
        root.render(
            <RegistrationInteractiveAuth
                client={client as never}
                username="new"
                password="pw"
                emailAddress="new@example.org"
                onCompleted={onCompleted}
                onBack={vi.fn()}
            />,
        );
    });
    return onCompleted;
}

describe("RegistrationInteractiveAuth email step", () => {
    it("waits for the link quietly, then finishes", async () => {
        const { client, server } = fakeServer();
        const onCompleted = renderSignUp(client);
        await settle();
        expect(server.emailsSent).toBe(1);

        await act(async () => button("Check again").click());
        await settle();
        expect(container.textContent).toContain("Confirm the verification email for new@example.org");
        expect(redText()).toEqual([]);

        server.linkClicked = true;
        await act(async () => button("Check again").click());
        await settle();
        expect(onCompleted).toHaveBeenCalledOnce();
    });

    it("still shows a real error, once", async () => {
        const { client } = fakeServer({ errcode: "M_FORBIDDEN", error: "Email address not allowed" });
        renderSignUp(client);
        await settle();

        await act(async () => button("Check again").click());
        await settle();
        expect(redText()).toEqual(["Email address not allowed"]);
    });
});

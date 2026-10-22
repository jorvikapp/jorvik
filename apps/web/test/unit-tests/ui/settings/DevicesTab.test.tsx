import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { DevicesTab } from "../../../../src/ui/settings/user/tabs/DevicesTab";

let container: HTMLDivElement;
let root: Root;
let scrolledIntoView: Element[];

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    scrolledIntoView = [];
    // jsdom has no layout, so it has no scrollIntoView either.
    Element.prototype.scrollIntoView = function (this: Element): void {
        scrolledIntoView.push(this);
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function makeClient(deleteDevice: Mock): MatrixClient {
    return {
        getDevices: vi.fn().mockResolvedValue({
            devices: [
                { device_id: "CURRENT", display_name: "Jorvik Desktop", last_seen_ts: 3000 },
                { device_id: "OLDPHONE", display_name: "Jorvik Web", last_seen_ts: 2000 },
                // Never used, so it sorts to the bottom of the list.
                { device_id: "UNUSED", display_name: "Jorvik Web" },
            ],
        }),
        getUserId: () => "@alice:example.org",
        getDeviceId: () => "CURRENT",
        getCrypto: () => undefined,
        deleteDevice,
    } as unknown as MatrixClient;
}

async function renderTab(client: MatrixClient): Promise<void> {
    await act(async () => {
        root.render(
            <DevicesTab
                client={client}
                verificationNonce={0}
                onOpenOwnVerification={() => undefined}
                onOpenDeviceVerification={() => undefined}
            />,
        );
    });
}

function rowFor(deviceId: string): HTMLElement {
    const row = Array.from(container.querySelectorAll<HTMLElement>(".settings-devices-item")).find((item) =>
        item.textContent?.includes(deviceId),
    );
    if (!row) throw new Error(`no row for ${deviceId}`);
    return row;
}

function buttonIn(scope: ParentNode, text: string): HTMLButtonElement {
    const button = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
    if (!button) throw new Error(`no button ${text}`);
    return button;
}

function setPassword(input: HTMLInputElement, value: string): void {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("DevicesTab", () => {
    // The box used to open above the whole list, out of sight when the session was far down it,
    // so Sign out looked like it did nothing.
    it("opens the sign-out box right under the session that was clicked, and scrolls to it", async () => {
        await renderTab(makeClient(vi.fn()));
        const row = rowFor("UNUSED");

        await act(async () => {
            buttonIn(row, "Sign out").click();
        });

        const box = container.querySelector(".settings-devices-signout");
        expect(box?.textContent).toContain("UNUSED");
        expect(row.nextElementSibling).toBe(box);
        expect(scrolledIntoView).toContain(box);
    });

    it("asks for the password in the same box, then signs the session out", async () => {
        const deleteDevice = vi
            .fn()
            .mockRejectedValueOnce({ httpStatus: 401, data: { session: "uia-1", flows: [{ stages: ["m.login.password"] }] } })
            .mockResolvedValueOnce({});
        const client = makeClient(deleteDevice);
        await renderTab(client);
        const row = rowFor("UNUSED");

        await act(async () => {
            buttonIn(row, "Sign out").click();
        });
        await act(async () => {
            buttonIn(container.querySelector(".settings-devices-signout")!, "Confirm sign out").click();
        });
        expect(deleteDevice).toHaveBeenCalledWith("UNUSED");

        const box = container.querySelector(".settings-devices-signout")!;
        expect(row.nextElementSibling).toBe(box);
        const password = box.querySelector<HTMLInputElement>("input[type=password]");
        expect(password).not.toBeNull();
        await act(async () => {
            setPassword(password!, "hunter2");
        });
        await act(async () => {
            buttonIn(box, "Confirm sign out").click();
        });

        expect(deleteDevice).toHaveBeenLastCalledWith(
            "UNUSED",
            expect.objectContaining({ type: "m.login.password", session: "uia-1", password: "hunter2" }),
        );
        expect(container.querySelector(".settings-devices-signout")).toBeNull();
        expect(client.getDevices).toHaveBeenCalledTimes(2);
    });

    it("closes the box on Cancel without signing anything out", async () => {
        const deleteDevice = vi.fn();
        await renderTab(makeClient(deleteDevice));

        await act(async () => {
            buttonIn(rowFor("OLDPHONE"), "Sign out").click();
        });
        await act(async () => {
            buttonIn(container.querySelector(".settings-devices-signout")!, "Cancel").click();
        });

        expect(container.querySelector(".settings-devices-signout")).toBeNull();
        expect(deleteDevice).not.toHaveBeenCalled();
    });
});

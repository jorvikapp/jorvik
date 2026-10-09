import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateSpaceDialog } from "../../../../src/ui/components/rooms/CreateSpaceDialog";

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
});

function makeClient() {
    return {
        getDomain: () => "example.org",
        isGuest: () => false,
        isVersionSupported: vi.fn().mockResolvedValue(true),
        doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
        createRoom: vi.fn().mockResolvedValue({ room_id: "!new:example.org" }),
    };
}

function buttonNamed(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
    if (!button) {
        throw new Error(`expected a "${text}" button`);
    }
    return button;
}

async function createSpace(client: ReturnType<typeof makeClient>, beforeCreate?: () => void): Promise<void> {
    await act(async () => {
        root.render(<CreateSpaceDialog client={client as never} open onClose={() => undefined} />);
    });
    await act(async () => {
        buttonNamed("Continue").click();
    });
    const nameInput = container.querySelector('input[placeholder="My Community"]') as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(nameInput, "Longship");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    beforeCreate?.();
    await act(async () => {
        buttonNamed("Create Space").click();
    });
}

function encryptionState(client: ReturnType<typeof makeClient>): unknown {
    const options = client.createRoom.mock.calls[0]?.[0] as { initial_state: Array<{ type: string; content: unknown }> };
    return options.initial_state.find((event) => event.type === "m.room.encryption")?.content;
}

describe("CreateSpaceDialog encryption", () => {
    it("creates Spaces end-to-end encrypted by default", async () => {
        const client = makeClient();
        await createSpace(client);

        expect(client.createRoom).toHaveBeenCalledTimes(1);
        expect(encryptionState(client)).toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
    });

    it("leaves encryption out when it's switched off", async () => {
        const client = makeClient();
        await createSpace(client, () => {
            const label = Array.from(container.querySelectorAll("label")).find((candidate) =>
                candidate.textContent?.includes("Enable end-to-end encryption"),
            );
            act(() => {
                (label?.querySelector("input") as HTMLInputElement).click();
            });
        });

        expect(client.createRoom).toHaveBeenCalledTimes(1);
        expect(encryptionState(client)).toBeUndefined();
    });
});

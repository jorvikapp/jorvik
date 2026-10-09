import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VisibilityTab } from "../../../../src/ui/settings/server/tabs/VisibilityTab";

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

/**
 * Directory visibility is not room state, so the tab has to fetch it. Everything
 * else on this tab reads synchronously off the Room.
 */
function makeRoom(roomId = "!space:example.org") {
    return {
        roomId,
        currentState: {
            getStateEvents: () => null,
            maySendStateEvent: () => true,
        },
    } as never;
}

function makeClient(overrides: Record<string, unknown> = {}) {
    return {
        getUserId: () => "@me:example.org",
        getRoomDirectoryVisibility: vi.fn().mockResolvedValue({ visibility: "private" }),
        setRoomDirectoryVisibility: vi.fn().mockResolvedValue({}),
        sendStateEvent: vi.fn().mockResolvedValue({}),
        ...overrides,
    } as never;
}

async function renderTab(client: unknown, room: unknown = makeRoom()): Promise<void> {
    await act(async () => {
        root.render(
            <VisibilityTab client={client as never} spaceRoom={room as never} onToast={() => undefined} />,
        );
    });
}

function publishToggle(): HTMLInputElement | null {
    const labels = Array.from(container.querySelectorAll("label.settings-toggle"));
    const label = labels.find(candidate => candidate.textContent?.includes("room directory"));
    return (label?.querySelector("input") as HTMLInputElement | undefined) ?? null;
}

function saveButton(): HTMLButtonElement {
    const button = container.querySelector(".settings-actions-row button");
    if (!button) {
        throw new Error("expected a save button");
    }
    return button as HTMLButtonElement;
}

describe("VisibilityTab directory publishing", () => {
    it("reflects the visibility the homeserver reports", async () => {
        await renderTab(makeClient({ getRoomDirectoryVisibility: vi.fn().mockResolvedValue({ visibility: "public" }) }));

        expect(publishToggle()?.checked).toBe(true);
    });

    it("publishes the space when the toggle is turned on and saved", async () => {
        const client = makeClient();
        await renderTab(client);

        const toggle = publishToggle();
        expect(toggle?.checked).toBe(false);
        // The save button stays disabled until something actually changes.
        expect(saveButton().disabled).toBe(true);

        await act(async () => {
            toggle!.click();
        });
        await act(async () => {
            saveButton().click();
        });

        expect((client as unknown as { setRoomDirectoryVisibility: ReturnType<typeof vi.fn> }).setRoomDirectoryVisibility)
            .toHaveBeenCalledWith("!space:example.org", "public");
    });

    it("explains a homeserver refusal rather than showing a bare error", async () => {
        const refusal = Object.assign(new Error("Not allowed to publish room"), { httpStatus: 403 });
        const client = makeClient({ setRoomDirectoryVisibility: vi.fn().mockRejectedValue(refusal) });
        await renderTab(client);

        await act(async () => {
            publishToggle()!.click();
        });
        await act(async () => {
            saveButton().click();
        });

        const error = container.querySelector(".settings-inline-error")?.textContent ?? "";
        expect(error).toContain("Not allowed to publish room");
        expect(error).toContain("restricts who may publish");
    });

    it("hides the toggle when the directory cannot be read, as for a remote space", async () => {
        const client = makeClient({
            getRoomDirectoryVisibility: vi.fn().mockRejectedValue(new Error("M_NOT_FOUND")),
        });
        await renderTab(client);

        expect(publishToggle()).toBeNull();
    });
});

describe("VisibilityTab encryption", () => {
    function encryptionRoom({ encrypted = false, canEncrypt = true } = {}) {
        return {
            roomId: "!space:example.org",
            currentState: {
                getStateEvents: (type: string) =>
                    type === "m.room.encryption" && encrypted ? { getContent: () => ({ algorithm: "m.megolm.v1.aes-sha2" }) } : null,
                maySendStateEvent: (type: string) => type !== "m.room.encryption" || canEncrypt,
            },
        } as never;
    }

    function encryptionCard(): Element {
        const card = Array.from(container.querySelectorAll(".settings-section-card")).find((candidate) =>
            candidate.querySelector("h3")?.textContent?.includes("End-to-end encryption"),
        );
        if (!card) {
            throw new Error("expected the encryption card");
        }
        return card;
    }

    function buttonNamed(text: string): HTMLButtonElement | undefined {
        return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
    }

    it("lets an admin encrypt the Space once they confirm", async () => {
        const client = makeClient();
        await renderTab(client, encryptionRoom());
        expect(encryptionCard().textContent).toContain("This Space isn't end-to-end encrypted.");

        await act(async () => {
            buttonNamed("Encrypt this Space")?.click();
        });
        expect(container.textContent).toContain("Encrypt this Space?");
        await act(async () => {
            buttonNamed("Encrypt")?.click();
        });

        expect((client as { sendStateEvent: ReturnType<typeof vi.fn> }).sendStateEvent).toHaveBeenCalledWith(
            "!space:example.org",
            "m.room.encryption",
            { algorithm: "m.megolm.v1.aes-sha2" },
            "",
        );
        expect(encryptionCard().textContent).toContain("This Space is end-to-end encrypted.");
        expect(buttonNamed("Encrypt this Space")).toBeUndefined();
    });

    it("sends nothing when the confirmation is cancelled", async () => {
        const client = makeClient();
        await renderTab(client, encryptionRoom());
        await act(async () => {
            buttonNamed("Encrypt this Space")?.click();
        });
        await act(async () => {
            buttonNamed("Cancel")?.click();
        });

        expect((client as { sendStateEvent: ReturnType<typeof vi.fn> }).sendStateEvent).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain("Encrypt this Space?");
    });

    it("says so when the Space is already encrypted, with nothing to press", async () => {
        await renderTab(makeClient(), encryptionRoom({ encrypted: true }));
        expect(encryptionCard().textContent).toContain("This Space is end-to-end encrypted.");
        expect(buttonNamed("Encrypt this Space")).toBeUndefined();
    });

    it("offers encryption only to those allowed to turn it on", async () => {
        await renderTab(makeClient(), encryptionRoom({ canEncrypt: false }));
        expect(encryptionCard().textContent).toContain("This Space isn't end-to-end encrypted.");
        expect(buttonNamed("Encrypt this Space")).toBeUndefined();
    });
});

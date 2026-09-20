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

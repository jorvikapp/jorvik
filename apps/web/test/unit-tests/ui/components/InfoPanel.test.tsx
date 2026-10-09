import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfoPanel } from "../../../../src/ui/components/rightSidebar/panels/InfoPanel";

const directRoomIds = new Set<string>();

vi.mock("../../../../src/ui/adapters/dmAdapter", () => ({
    getDirectRoomIds: vi.fn(() => directRoomIds),
}));

vi.mock("../../../../src/ui/adapters/roomNotificationAdapter", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../src/ui/adapters/roomNotificationAdapter")>();
    return {
        ...actual,
        getRoomNotificationMode: vi.fn(() => actual.RoomNotificationMode.Default),
        setRoomNotificationMode: vi.fn(async () => undefined),
    };
});

let container: HTMLDivElement;
let root: Root;

const client = { getUserId: () => "@alice:test.local", on: vi.fn(), removeListener: vi.fn() };
const room = {
    roomId: "!room:test.local",
    currentState: { getStateEvents: () => null, maySendStateEvent: () => false },
};

async function renderPanel(onClose: () => void): Promise<void> {
    await act(async () => {
        root.render(
            <InfoPanel
                client={client as never}
                room={room as never}
                onOpenRoomSettings={vi.fn()}
                onCopyRoomLink={vi.fn(async () => undefined)}
                onLeaveRoom={vi.fn(async () => undefined)}
                onClose={onClose}
            />,
        );
    });
}

describe("InfoPanel", () => {
    beforeEach(() => {
        directRoomIds.clear();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("closes from its own header", async () => {
        const onClose = vi.fn();
        await renderPanel(onClose);

        const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close channel info"]');
        expect(close).not.toBeNull();
        await act(async () => {
            close!.click();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls it chat info in a direct message", async () => {
        directRoomIds.add(room.roomId);
        await renderPanel(vi.fn());

        expect(container.querySelector(".rs-panel-title")?.textContent).toBe("Chat info");
        expect(container.querySelector('button[aria-label="Close chat info"]')).not.toBeNull();
    });
});

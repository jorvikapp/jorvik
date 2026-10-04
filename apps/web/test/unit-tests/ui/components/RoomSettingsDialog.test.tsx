import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DM_ROOM_ID = "!dm:matrix.jorvik.app";

vi.mock("../../../../src/ui/adapters/dmAdapter", () => ({
    getDirectRoomIds: () => new Set([DM_ROOM_ID]),
}));
vi.mock("../../../../src/ui/components/rightPanel/directPartner", () => ({
    getOneToOneDirectName: () => "Riff",
    getOneToOneDirectLabel: () => "Riff (@riff)",
}));
vi.mock("../../../../src/ui/adapters/roomNotificationAdapter", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../src/ui/adapters/roomNotificationAdapter")>();
    return {
        ...actual,
        getRoomNotificationMode: vi.fn(() => actual.RoomNotificationMode.Default),
        setRoomNotificationMode: vi.fn(async () => undefined),
    };
});

import { RoomNotificationMode, setRoomNotificationMode } from "../../../../src/ui/adapters/roomNotificationAdapter";
import { RoomSettingsDialog } from "../../../../src/ui/components/rooms/RoomSettingsDialog";

let container: HTMLDivElement;
let root: Root;

const client = { getUserId: () => "@me:matrix.jorvik.app", getDomain: () => "matrix.jorvik.app" } as never;

function fakeRoom(roomId: string, name: string) {
    return {
        roomId,
        name,
        getCanonicalAlias: () => null,
        currentState: { getStateEvents: () => null, maySendStateEvent: () => true },
        getMember: () => ({ powerLevel: 100 }),
        getMyMembership: () => "join",
    } as never;
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(setRoomNotificationMode).mockClear();
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

function render(room: never, onClose = vi.fn()) {
    act(() => {
        root.render(<RoomSettingsDialog client={client} room={room} open onClose={onClose} />);
    });
    return onClose;
}

const button = (label: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label) as HTMLButtonElement;

describe("RoomSettingsDialog", () => {
    it("calls a DM a chat and saves your notification choice with the rest", async () => {
        const onClose = render(fakeRoom(DM_ROOM_ID, "Riff"));
        expect(document.querySelector(".room-dialog-title")?.textContent).toBe("Chat settings: Riff");
        expect(document.body.textContent).toContain("Chat name");
        act(() => {
            button("Mute").click();
        });
        expect(document.querySelector(".room-dialog-helper")?.textContent).toBe("Nothing here notifies you, not even mentions.");
        expect(setRoomNotificationMode).not.toHaveBeenCalled();
        await act(async () => {
            button("Save").click();
        });
        expect(setRoomNotificationMode).toHaveBeenCalledWith(client, DM_ROOM_ID, RoomNotificationMode.Mute);
        expect(onClose).toHaveBeenCalled();
    });

    it("calls a channel a channel, and changes nothing when only cancelled", () => {
        const onClose = render(fakeRoom("!general:matrix.jorvik.app", "general"));
        expect(document.querySelector(".room-dialog-title")?.textContent).toBe("Channel settings: general");
        act(() => {
            button("Mentions only").click();
        });
        act(() => {
            button("Cancel").click();
        });
        expect(onClose).toHaveBeenCalled();
        expect(setRoomNotificationMode).not.toHaveBeenCalled();
    });
});

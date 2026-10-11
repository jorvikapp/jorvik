import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientEvent, EventType } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelsTab } from "../../../../src/ui/settings/server/tabs/ChannelsTab";

// The list itself has its own tests; here it only has to show what it's given.
vi.mock("../../../../src/ui/components/RoomList", () => ({
    RoomList: ({ rooms, activeRoomId }: { rooms: Array<{ roomId: string }>; activeRoomId: string | null }) => (
        <ul className="stub-room-list">
            {rooms.map((room) => (
                <li key={room.roomId} className={room.roomId === activeRoomId ? "is-active" : undefined}>
                    {room.roomId}
                </li>
            ))}
        </ul>
    ),
}));

const SPACE = "!space:example.org";
const NEW_ROOM = "!new:example.org";

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
    const emitter = new EventEmitter();
    let synced = false;
    const space = {
        roomId: SPACE,
        currentState: {
            maySendStateEvent: () => true,
            getStateEvents: (type: string, stateKey: string) =>
                synced && type === EventType.SpaceChild && stateKey === NEW_ROOM ? { getStateKey: () => NEW_ROOM } : null,
        },
    };
    return {
        getUserId: () => "@me:example.org",
        getDomain: () => "example.org",
        getRoom: (roomId: string) => (roomId === SPACE ? space : roomId === NEW_ROOM && synced ? { roomId } : null),
        getProfileInfo: vi.fn(async () => ({})),
        createRoom: vi.fn(async () => ({ room_id: NEW_ROOM })),
        sendStateEvent: vi.fn(async () => ({ event_id: "$state" })),
        on: emitter.on.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter),
        sync() {
            synced = true;
            emitter.emit(ClientEvent.Sync, "SYNCING", "SYNCING");
        },
    };
}

function button(text: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
    if (!found) {
        throw new Error(`expected a "${text}" button`);
    }
    return found as HTMLButtonElement;
}

describe("ChannelsTab", () => {
    it("makes a channel without leaving settings, and picks it in the list", async () => {
        const client = makeClient();
        const onSelectRoom = vi.fn();
        const render = (rooms: Array<{ roomId: string }>, activeRoomId: string | null) =>
            root.render(
                <ChannelsTab
                    client={client as never}
                    spaceId={SPACE}
                    rooms={rooms as never}
                    activeRoomId={activeRoomId}
                    onSelectRoom={onSelectRoom}
                    onRefreshChannels={async () => undefined}
                />,
            );
        await act(async () => {
            render([{ roomId: "!general:example.org" }], "!general:example.org");
        });

        await act(async () => {
            button("Create channel").click();
        });

        // The dialog is part of the tab, so it opens over settings rather than behind them.
        expect(container.querySelector('.room-dialog-overlay[aria-label="Create channel"]')).not.toBeNull();
        const name = container.querySelector('input[placeholder="General"]') as HTMLInputElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Plans");
            name.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            button("Create").click();
        });
        await act(async () => {
            client.sync();
        });

        expect(onSelectRoom).toHaveBeenCalledWith(NEW_ROOM);
        expect(container.querySelector(".room-dialog-overlay")).toBeNull();
    });
});

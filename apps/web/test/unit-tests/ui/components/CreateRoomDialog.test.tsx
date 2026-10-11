import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientEvent, EventType } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateRoomDialog } from "../../../../src/ui/components/rooms/CreateRoomDialog";

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

// A client whose sync hasn't yet brought the new room or the space's child for it;
// `sync()` brings both.
function makeClient(options: { canAddToSpace?: boolean } = {}) {
    const emitter = new EventEmitter();
    let synced = false;
    const space = {
        roomId: SPACE,
        currentState: {
            maySendStateEvent: (type: string) => type === EventType.SpaceChild && options.canAddToSpace !== false,
            getStateEvents: (type: string, stateKey: string) =>
                synced && type === EventType.SpaceChild && stateKey === NEW_ROOM ? { getStateKey: () => NEW_ROOM } : null,
        },
    };
    return {
        getUserId: () => "@me:example.org",
        getDomain: () => "example.org",
        getRoom: (roomId: string) => (roomId === SPACE ? space : roomId === NEW_ROOM && synced ? { roomId } : null),
        getProfileInfo: vi.fn(async (userId: string) => {
            if (userId !== "@dave:example.org") {
                throw Object.assign(new Error("No row found (profiles)"), { httpStatus: 404 });
            }
            return { displayname: "Dave" };
        }),
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

function type(selector: string, value: string): void {
    const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    act(() => {
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function createButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Create");
    if (!button) {
        throw new Error('expected a "Create" button');
    }
    return button as HTMLButtonElement;
}

async function render(client: ReturnType<typeof makeClient>, props: { spaceParentId?: string; onCreated?: (roomId: string) => void } = {}) {
    await act(async () => {
        root.render(
            <CreateRoomDialog client={client as never} open spaceParentId={props.spaceParentId ?? null} onClose={() => undefined} onCreated={props.onCreated} />,
        );
    });
}

describe("CreateRoomDialog", () => {
    it("invites a bare @name as someone on our own server", async () => {
        const client = makeClient();
        await render(client);
        type('input[placeholder="General"]', "Plans");
        type('textarea[placeholder="@alice @bob:example.org"]', "@Dave");

        await act(async () => {
            createButton().click();
        });

        expect(client.createRoom).toHaveBeenCalledWith(expect.objectContaining({ name: "Plans", invite: ["@dave:example.org"] }));
    });

    it("makes nothing when an invite names someone the server doesn't have", async () => {
        const client = makeClient();
        await render(client);
        type('textarea[placeholder="@alice @bob:example.org"]', "@daev");

        await act(async () => {
            createButton().click();
        });

        expect(client.createRoom).not.toHaveBeenCalled();
        expect(container.querySelector(".room-dialog-error")?.textContent).toBe("@daev: User was not found on the homeserver.");
    });

    it("hands over a new channel only once this client has it in the space", async () => {
        const client = makeClient();
        const onCreated = vi.fn();
        await render(client, { spaceParentId: SPACE, onCreated });
        type('input[placeholder="General"]', "Plans");

        await act(async () => {
            createButton().click();
        });

        expect(client.sendStateEvent).toHaveBeenCalledWith(SPACE, EventType.SpaceChild, expect.objectContaining({ via: ["example.org"] }), NEW_ROOM);
        expect(onCreated).not.toHaveBeenCalled();

        await act(async () => {
            client.sync();
        });

        expect(onCreated).toHaveBeenCalledWith(NEW_ROOM);
    });

    it("won't make a channel for someone who can't add one to the space", async () => {
        const client = makeClient({ canAddToSpace: false });
        await render(client, { spaceParentId: SPACE });

        expect(createButton().disabled).toBe(true);
        expect(container.querySelector(".room-dialog-warning")?.textContent).toBe(
            "You don't have permission to add channels to this Space.",
        );
    });
});

import { EventEmitter } from "events";
import { ClientEvent, EventType } from "matrix-js-sdk/src/matrix";
import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForSpaceChild } from "../../../../src/core/spaces/waitForSpaceChild";

const SPACE = "!space:example.org";
const CHANNEL = "!new:example.org";

// What this client has so far: which rooms, and which children each space's state lists.
function makeClient() {
    const emitter = new EventEmitter();
    const rooms = new Set<string>([SPACE]);
    const children = new Set<string>();
    const room = (roomId: string) => ({
        roomId,
        currentState: {
            getStateEvents: (type: string, stateKey: string) =>
                roomId === SPACE && type === EventType.SpaceChild && children.has(stateKey) ? { getStateKey: () => stateKey } : null,
        },
    });
    return {
        client: {
            getRoom: (roomId: string) => (rooms.has(roomId) ? room(roomId) : null),
            on: emitter.on.bind(emitter),
            removeListener: emitter.removeListener.bind(emitter),
        },
        sync(change: { room?: boolean; child?: boolean }) {
            if (change.room) rooms.add(CHANNEL);
            if (change.child) children.add(CHANNEL);
            emitter.emit(ClientEvent.Sync, "SYNCING", "SYNCING");
        },
        listeners: () => emitter.listenerCount(ClientEvent.Sync),
    };
}

afterEach(() => {
    vi.useRealTimers();
});

// Lets every promise that can settle do so.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("waitForSpaceChild", () => {
    it("is done at once when both are here already", async () => {
        const rig = makeClient();
        rig.sync({ room: true, child: true });

        await expect(waitForSpaceChild(rig.client as never, SPACE, CHANNEL)).resolves.toBe(true);
        expect(rig.listeners()).toBe(0);
    });

    it("waits for the sync that brings the space's child, not just the room", async () => {
        const rig = makeClient();
        let done: boolean | null = null;
        void waitForSpaceChild(rig.client as never, SPACE, CHANNEL).then((known) => {
            done = known;
        });

        rig.sync({ room: true });
        await settle();
        expect(done).toBeNull();

        rig.sync({ child: true });
        await settle();
        expect(done).toBe(true);
        expect(rig.listeners()).toBe(0);
    });

    it("gives up after the timeout and stops listening", async () => {
        vi.useFakeTimers();
        const rig = makeClient();
        const waiting = waitForSpaceChild(rig.client as never, SPACE, CHANNEL, 5_000);

        rig.sync({ room: true });
        vi.advanceTimersByTime(5_000);

        await expect(waiting).resolves.toBe(false);
        expect(rig.listeners()).toBe(0);
    });
});

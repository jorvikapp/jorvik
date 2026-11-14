import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventEmitter } from "events";
import { MatrixEvent, User, UserEvent } from "matrix-js-sdk/src/matrix";

import type { PresenceVm } from "../../../../src/ui/presence/buildPresenceVm";
import { presenceStatusMessage, usePresenceMap, usePresenceVm } from "../../../../src/ui/presence/usePresence";

const USER_ID = "@jason:example.org";

let container: HTMLDivElement;
let root: Root;
let latest: PresenceVm | null = null;

function Probe({ client }: { client: unknown }): null {
    latest = usePresenceVm(client as never, USER_ID, true);
    return null;
}

describe("usePresenceVm", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
        container = document.createElement("div");
        root = createRoot(container);
        latest = null;
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
    });

    it("keeps counting how long an idle user has been away", async () => {
        // The server reported "idle, last active 5 minutes ago" just now, and sends
        // nothing more while the user stays idle.
        const user = {
            userId: USER_ID,
            presence: "unavailable",
            currentlyActive: false,
            lastActiveAgo: 5 * 60_000,
            lastPresenceTs: Date.now(),
        };
        const client = { getUser: vi.fn(() => user), on: vi.fn(), removeListener: vi.fn() };

        await act(async () => {
            root.render(<Probe client={client} />);
        });
        expect(latest?.primaryLabel).toBe("Idle");
        expect(latest?.secondaryLabel).toBe("Last active 5m ago");

        await act(async () => {
            vi.advanceTimersByTime(10 * 60_000);
        });
        expect(latest?.secondaryLabel).toBe("Last active 15m ago");
    });
});

// A real SDK User, whose events the client passes on, as the SDK's own client does.
function liveUser(userId: string): { user: User; client: unknown; presence: (content: Record<string, unknown>) => void } {
    const user = new User(userId);
    const client = Object.assign(new EventEmitter(), { getUser: (id: string) => (id === userId ? user : null) });
    for (const event of [UserEvent.Presence, UserEvent.CurrentlyActive, UserEvent.LastPresenceTs]) {
        user.on(event as never, (...args: unknown[]) => client.emit(event, ...args));
    }
    const presence = (content: Record<string, unknown>): void => {
        act(() => user.setPresenceEvent(new MatrixEvent({ type: "m.presence", sender: userId, content })));
    };
    return { user, client, presence };
}

describe("usePresenceMap: status messages while someone stays online", () => {
    const BOB = "@bob:example.org";
    let renders = 0;
    let shown: string | null | undefined;

    function StatusProbe({ client }: { client: unknown }): null {
        renders++;
        shown = usePresenceMap(client as never, [BOB], true).get(BOB)?.statusMessage;
        return null;
    }

    beforeEach(() => {
        container = document.createElement("div");
        root = createRoot(container);
        renders = 0;
        shown = undefined;
    });

    afterEach(() => {
        act(() => root.unmount());
    });

    it("shows a status set, changed and cleared without a reload", async () => {
        const { client, presence, user } = liveUser(BOB);
        presence({ presence: "online", currently_active: true });
        await act(async () => root.render(<StatusProbe client={client} />));
        expect(shown).toBeNull();

        // Set while online: the SDK fires only LastPresenceTs for this.
        presence({ presence: "online", currently_active: true, status_msg: "twitch.tv/bob" });
        expect(shown).toBe("twitch.tv/bob");

        presence({ presence: "online", currently_active: true, status_msg: "back in 5" });
        expect(shown).toBe("back in 5");

        // Cleared: the SDK keeps its old copy, but the row must not.
        presence({ presence: "online", currently_active: true });
        expect(user.presenceStatusMsg).toBe("back in 5");
        expect(shown).toBeNull();
    });

    it("doesn't redraw for an update that changes nothing shown", async () => {
        const { client, presence } = liveUser(BOB);
        presence({ presence: "online", currently_active: true, status_msg: "hi" });
        await act(async () => root.render(<StatusProbe client={client} />));
        const before = renders;
        presence({ presence: "online", currently_active: true, status_msg: "hi", last_active_ago: 1000 });
        presence({ presence: "online", currently_active: true, status_msg: "hi", last_active_ago: 2000 });
        expect(renders).toBe(before);
        presence({ presence: "unavailable", currently_active: false, status_msg: "hi" });
        expect(renders).toBe(before + 1);
    });

    it("hides the status of someone who goes offline, as before", async () => {
        const { client, presence } = liveUser(BOB);
        presence({ presence: "online", currently_active: true, status_msg: "hi" });
        await act(async () => root.render(<StatusProbe client={client} />));
        expect(shown).toBe("hi");
        presence({ presence: "offline", status_msg: "hi" });
        expect(shown).toBeNull();
    });
});

describe("presenceStatusMessage", () => {
    it("reads the latest presence event, and the SDK's copy only without one", () => {
        const user = new User("@a:b");
        expect(presenceStatusMessage(user)).toBeNull();
        user.presenceStatusMsg = "old";
        expect(presenceStatusMessage(user)).toBe("old");
        user.setPresenceEvent(new MatrixEvent({ type: "m.presence", sender: "@a:b", content: { presence: "online", status_msg: "  " } }));
        expect(presenceStatusMessage(user)).toBeNull();
        expect(presenceStatusMessage(null)).toBeNull();
    });
});

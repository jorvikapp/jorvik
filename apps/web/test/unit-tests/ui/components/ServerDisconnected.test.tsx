import React, { act } from "react";
import { EventEmitter } from "events";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEvent, SyncState, type MatrixClient } from "matrix-js-sdk/src/matrix";

import { ServerDisconnected } from "../../../../src/ui/components/ServerDisconnected";

let container: HTMLDivElement;
let root: Root;

function fakeClient(homeserver = "https://matrix.jorvik.app"): MatrixClient & EventEmitter {
    const emitter = new EventEmitter() as MatrixClient & EventEmitter;
    let state: SyncState | null = SyncState.Syncing;
    emitter.on(ClientEvent.Sync, (next: SyncState) => {
        state = next;
    });
    Object.assign(emitter, {
        getSyncState: () => state,
        getHomeserverUrl: () => homeserver,
        retryImmediately: vi.fn(() => true),
    });
    return emitter;
}

const screen = (): HTMLElement | null => container.querySelector(".server-disconnected");
const button = (text: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
    await act(async () => {
        vi.advanceTimersByTime(ms);
    });
}

/** A healthy server: sync answers every 30 s for `ms`. */
async function syncFor(client: MatrixClient & EventEmitter, ms: number): Promise<void> {
    for (let spent = 0; spent < ms; spent += 30_000) {
        await advance(Math.min(30_000, ms - spent));
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
        });
    }
}

describe("ServerDisconnected", () => {
    it("shows after two minutes without the server and goes away when it's back", async () => {
        const client = fakeClient();
        await act(async () => root.render(<ServerDisconnected client={client} />));
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        });
        await advance(60_000);
        expect(screen()).toBeNull();
        await advance(61_000);
        expect(screen()?.textContent).toContain("Disconnected from the server");
        expect(container.querySelector("a")?.getAttribute("href")).toBe("https://status.jorvik.app");

        button("Try again")!.click();
        expect(client.retryImmediately).toHaveBeenCalled();

        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Error);
        });
        expect(screen()).toBeNull();
    });

    it("doesn't show for a short drop, or while the server keeps answering", async () => {
        const client = fakeClient();
        await act(async () => root.render(<ServerDisconnected client={client} />));
        await syncFor(client, 300_000);
        expect(screen()).toBeNull();
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Reconnecting, SyncState.Syncing);
        });
        await advance(60_000);
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Reconnecting);
        });
        await syncFor(client, 200_000);
        expect(screen()).toBeNull();
    });

    it("shows for a server that stops answering without an error", async () => {
        const client = fakeClient();
        await act(async () => root.render(<ServerDisconnected client={client} />));
        await syncFor(client, 60_000);
        // No sync answer and no error from here: a frozen server.
        await advance(119_000);
        expect(screen()).toBeNull();
        await advance(2_000);
        expect(screen()).not.toBeNull();
    });

    it("doesn't count time the computer was asleep", async () => {
        const client = fakeClient();
        await act(async () => root.render(<ServerDisconnected client={client} />));
        await act(async () => {
            // Timers don't run during sleep; the clock jumps ahead.
            vi.setSystemTime(Date.now() + 600_000);
            vi.advanceTimersByTime(1_000);
        });
        expect(screen()).toBeNull();
    });

    it("Keep reading hides it until the server goes away again", async () => {
        const client = fakeClient();
        await act(async () => root.render(<ServerDisconnected client={client} />));
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        });
        await advance(121_000);
        await act(async () => button("Keep reading")!.click());
        await advance(5_000);
        expect(screen()).toBeNull();
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Error);
        });
        expect(screen()).toBeNull();
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        });
        await advance(121_000);
        expect(screen()).not.toBeNull();
    });

    it("only links the status page for Jorvik's own server", async () => {
        const client = fakeClient("https://matrix.example.org");
        await act(async () => root.render(<ServerDisconnected client={client} />));
        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing);
        });
        await advance(121_000);
        expect(screen()).not.toBeNull();
        expect(container.querySelector("a")).toBeNull();
    });
});

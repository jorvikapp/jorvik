import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PresenceChoice } from "../../../../src/core/presence/presenceControl";
import {
    usePresenceSelection,
    type PresenceSelectionController,
} from "../../../../src/ui/presence/usePresenceSelection";

const STORAGE_KEY = "jorvik_presence_selection";

let container: HTMLDivElement;
let root: Root;
let controller: PresenceSelectionController | null = null;

function makeClient() {
    return {
        setSyncPresence: vi.fn(),
        setPresence: vi.fn(async () => undefined),
        on: vi.fn(),
        removeListener: vi.fn(),
    };
}

function Probe({ client, away }: { client: ReturnType<typeof makeClient>; away: boolean }): null {
    controller = usePresenceSelection(client as never, true, away);
    return null;
}

async function render(client: ReturnType<typeof makeClient>, away: boolean): Promise<void> {
    await act(async () => {
        root.render(<Probe client={client} away={away} />);
    });
}

function published(client: ReturnType<typeof makeClient>): string[] {
    return client.setPresence.mock.calls.map(([body]) => (body as { presence: string }).presence);
}

function storeChoice(choice: PresenceChoice): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, statusMessage: "" }));
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    controller = null;
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    window.localStorage.removeItem(STORAGE_KEY);
});

describe("usePresenceSelection auto-idle", () => {
    it("publishes Idle for an Online selection while away, and Online again after", async () => {
        storeChoice("online");
        const client = makeClient();

        await render(client, false);
        await render(client, true);
        expect(controller?.effectiveChoice).toBe("idle");
        expect(controller?.autoIdle).toBe(true);
        expect(controller?.selection.choice).toBe("online");

        await render(client, false);
        expect(published(client)).toEqual(["online", "unavailable", "online"]);
        // The user's own choice is never overwritten by auto-idle.
        expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").choice).toBe("online");
    });

    it("leaves Do Not Disturb and Invisible alone while away", async () => {
        for (const choice of ["dnd", "invisible"] as const) {
            storeChoice(choice);
            const client = makeClient();
            await render(client, true);
            expect(controller?.effectiveChoice).toBe(choice);
            expect(controller?.autoIdle).toBe(false);
            act(() => {
                root.unmount();
            });
            root = createRoot(container);
        }
    });

    it("publishes a status change made from the menu", async () => {
        storeChoice("online");
        const client = makeClient();
        await render(client, false);

        await act(async () => {
            controller?.setChoice("idle");
        });
        expect(published(client)).toEqual(["online", "unavailable"]);
    });
});

describe("usePresenceSelection status message", () => {
    function statusMessages(client: ReturnType<typeof makeClient>): Array<string | undefined> {
        return client.setPresence.mock.calls.map(([body]) => (body as { status_msg?: string }).status_msg);
    }

    function storeSelection(choice: PresenceChoice, statusMessage: string): void {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, statusMessage }));
    }

    // 1.0.27 put "Playing ..." here while a game ran; game activity now travels on its own, encrypted
    // and only to the people picked (core/activity), so the status message is only ever the user's.
    it("publishes the status the user set, and clears an empty one", async () => {
        storeSelection("online", "back at 8");
        const client = makeClient();
        await render(client, false);
        expect(controller?.effectiveStatusMessage).toBe("back at 8");

        await act(async () => {
            controller?.setStatusMessage("");
        });
        expect(statusMessages(client)).toEqual(["back at 8", undefined]);
    });
});

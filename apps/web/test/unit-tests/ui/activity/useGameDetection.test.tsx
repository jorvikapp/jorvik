import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityGame } from "../../../../src/core/activity/activityWire";
import { toDetectedGame, useGameDetection } from "../../../../src/ui/activity/useGameDetection";

let container: HTMLDivElement;
let root: Root;
let game: ActivityGame | null = null;

function Probe({ enabled }: { enabled: boolean }): null {
    game = useGameDetection(enabled);
    return null;
}

async function render(enabled: boolean): Promise<void> {
    await act(async () => {
        root.render(<Probe enabled={enabled} />);
    });
}

type Reported = ActivityGame | string | null;

function desktopBridge(running: Reported) {
    let listener: ((next: Reported) => void) | null = null;
    return {
        setGameActivityEnabled: vi.fn(async (enabled: boolean) => (enabled ? running : null)),
        onGameActivity: vi.fn((next: (game: Reported) => void) => {
            listener = next;
            return () => {
                listener = null;
            };
        }),
        report: (next: Reported) => act(() => listener?.(next)),
    };
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    game = null;
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.heorotDesktop;
});

describe("useGameDetection", () => {
    it("asks the desktop app to look for games only while sharing is on, and follows what it reports", async () => {
        const bridge = desktopBridge({ id: "steam-413150", name: "Stardew Valley" });
        window.heorotDesktop = bridge;

        await render(false);
        expect(bridge.setGameActivityEnabled).not.toHaveBeenCalledWith(true);
        // Stops a search left running by a page that reloaded with it on.
        expect(bridge.setGameActivityEnabled).toHaveBeenLastCalledWith(false);

        await render(true);
        expect(bridge.setGameActivityEnabled).toHaveBeenLastCalledWith(true);
        expect(game).toEqual({ id: "steam-413150", name: "Stardew Valley" });

        await bridge.report({ id: "minecraft", name: "Minecraft" });
        expect(game).toEqual({ id: "minecraft", name: "Minecraft" });
        await bridge.report(null);
        expect(game).toBeNull();

        await bridge.report({ id: "minecraft", name: "Minecraft" });
        await render(false);
        expect(bridge.setGameActivityEnabled).toHaveBeenLastCalledWith(false);
        expect(game).toBeNull();
    });

    it("gives a game from a desktop app that only reports names an id of its own", async () => {
        window.heorotDesktop = desktopBridge("World of Warcraft");
        await render(true);
        expect(game).toEqual({ id: "world-of-warcraft", name: "World of Warcraft" });
        expect(toDetectedGame({ id: "Not An Id", name: "x" })).toBeNull();
    });

    it("is always null in a browser", async () => {
        await render(true);
        expect(game).toBeNull();
    });
});

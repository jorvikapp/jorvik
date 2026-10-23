import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGameActivity } from "../../../../src/ui/presence/useGameActivity";

let container: HTMLDivElement;
let root: Root;
let game: string | null = null;

function Probe({ enabled }: { enabled: boolean }): null {
    game = useGameActivity(enabled);
    return null;
}

async function render(enabled: boolean): Promise<void> {
    await act(async () => {
        root.render(<Probe enabled={enabled} />);
    });
}

function desktopBridge(running: string | null) {
    let listener: ((next: string | null) => void) | null = null;
    return {
        setGameActivityEnabled: vi.fn(async (enabled: boolean) => (enabled ? running : null)),
        onGameActivity: vi.fn((next: (game: string | null) => void) => {
            listener = next;
            return () => {
                listener = null;
            };
        }),
        report: (next: string | null) => act(() => listener?.(next)),
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

describe("useGameActivity", () => {
    it("asks the desktop app to look for games only while turned on, and follows what it reports", async () => {
        const bridge = desktopBridge("Stardew Valley");
        window.heorotDesktop = bridge;

        await render(false);
        expect(bridge.setGameActivityEnabled).not.toHaveBeenCalledWith(true);
        // Stops a search left running by a page that reloaded with it on.
        expect(bridge.setGameActivityEnabled).toHaveBeenLastCalledWith(false);

        await render(true);
        expect(bridge.setGameActivityEnabled).toHaveBeenLastCalledWith(true);
        expect(game).toBe("Stardew Valley");

        await bridge.report("Minecraft");
        expect(game).toBe("Minecraft");
        await bridge.report(null);
        expect(game).toBeNull();

        await bridge.report("Minecraft");
        await render(false);
        expect(bridge.setGameActivityEnabled).toHaveBeenLastCalledWith(false);
        expect(game).toBeNull();
    });

    it("is always null in a browser", async () => {
        await render(true);
        expect(game).toBeNull();
    });
});

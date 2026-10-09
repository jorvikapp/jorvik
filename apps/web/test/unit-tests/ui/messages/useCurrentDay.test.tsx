import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCurrentDay } from "../../../../src/ui/messages/useCurrentDay";

let container: HTMLDivElement;
let root: Root;
let latest: Date | null = null;

function Probe(): null {
    latest = useCurrentDay();
    return null;
}

describe("useCurrentDay", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 8, 23, 59));
        container = document.createElement("div");
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
    });

    it("moves on to the next day at midnight", async () => {
        await act(async () => {
            root.render(<Probe />);
        });
        expect(latest?.getDate()).toBe(8);

        await act(async () => {
            vi.advanceTimersByTime(2 * 60_000);
        });
        expect(latest?.getDate()).toBe(9);
    });

    it("catches up when the window comes back after a missed midnight", async () => {
        await act(async () => {
            root.render(<Probe />);
        });
        // The clock jumps past midnight without the timer firing, as after sleep.
        vi.setSystemTime(new Date(2026, 9, 9, 7, 30));
        await act(async () => {
            window.dispatchEvent(new Event("focus"));
        });
        expect(latest?.getDate()).toBe(9);
    });
});

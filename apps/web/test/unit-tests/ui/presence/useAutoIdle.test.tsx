import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveIdleMs, useAutoIdle } from "../../../../src/ui/presence/useAutoIdle";

const MINUTE = 60_000;

let container: HTMLDivElement;
let root: Root;
let away: boolean | null = null;

function Probe({ thresholdMs }: { thresholdMs: number }): null {
    away = useAutoIdle(thresholdMs);
    return null;
}

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

function setSystemIdle(read: (() => Promise<number>) | null): void {
    (window as { heorotDesktop?: unknown }).heorotDesktop = read ? { getSystemIdleSeconds: read } : undefined;
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    away = null;
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    setSystemIdle(null);
    vi.useRealTimers();
});

describe("resolveIdleMs", () => {
    it("uses the system idle time only once it is known to work", () => {
        expect(resolveIdleMs(9 * MINUTE, 2_000, true)).toBe(2_000);
        expect(resolveIdleMs(9 * MINUTE, 0, false)).toBe(9 * MINUTE);
        expect(resolveIdleMs(9 * MINUTE, null, true)).toBe(9 * MINUTE);
    });
});

describe("useAutoIdle", () => {
    it("goes idle after the threshold without activity and back on input", async () => {
        act(() => root.render(<Probe thresholdMs={10 * MINUTE} />));
        await advance(9 * MINUTE);
        expect(away).toBe(false);

        await advance(MINUTE + 5_000);
        expect(away).toBe(true);

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        });
        expect(away).toBe(false);
    });

    it("never goes idle when the threshold is 0", async () => {
        act(() => root.render(<Probe thresholdMs={0} />));
        await advance(120 * MINUTE);
        expect(away).toBe(false);
    });

    it("stays online on desktop while the system reports activity elsewhere", async () => {
        setSystemIdle(async () => 3);
        act(() => root.render(<Probe thresholdMs={10 * MINUTE} />));
        await advance(30 * MINUTE);
        expect(away).toBe(false);
    });

    it("goes idle on desktop when the system itself has been idle", async () => {
        let seconds = 1;
        setSystemIdle(async () => seconds);
        act(() => root.render(<Probe thresholdMs={10 * MINUTE} />));
        await advance(10_000);
        seconds = 11 * 60;
        await advance(10_000);
        expect(away).toBe(true);

        // Back at the computer, in another app: within one check.
        seconds = 0;
        await advance(5_000);
        expect(away).toBe(false);
    });

    it("falls back to activity in Jorvik when the system idle time is stuck at 0", async () => {
        setSystemIdle(async () => 0);
        act(() => root.render(<Probe thresholdMs={10 * MINUTE} />));
        await advance(10 * MINUTE + 10_000);
        expect(away).toBe(true);
    });
});

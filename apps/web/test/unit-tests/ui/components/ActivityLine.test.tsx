import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearActivity, receiveActivity } from "../../../../src/core/activity/activityStore";
import { ActivityLine, activityText, formatPlayingFor } from "../../../../src/ui/components/activity/ActivityLine";

const WOW = { id: "wow", name: "World of Warcraft" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearActivity();
});

describe("ActivityLine", () => {
    it("says for how long, from the first minute on", () => {
        expect(formatPlayingFor(59_000)).toBeNull();
        expect(formatPlayingFor(5 * 60_000)).toBe("5m");
        expect(formatPlayingFor(83 * 60_000)).toBe("1h 23m");
        expect(formatPlayingFor(120 * 60_000)).toBe("2h");
        expect(activityText({ game: WOW, startedAt: 0, expiresAt: 1, receivedAt: 0 }, 83 * 60_000)).toBe(
            "Playing World of Warcraft · 1h 23m",
        );
    });

    it("shows what someone shares with us, and goes when they stop", () => {
        act(() => {
            root.render(<ActivityLine userId="@bob:s" />);
        });
        expect(container.textContent).toBe("");

        act(() => {
            receiveActivity("@bob:s", "PC", { game: WOW, startedAt: Date.now() - 83 * 60_000, expiresAt: Date.now() + 60_000 }, Date.now());
        });
        expect(container.textContent).toContain("Playing World of Warcraft · 1h 23m");

        act(() => {
            receiveActivity("@bob:s", "PC", { game: null }, Date.now());
        });
        expect(container.textContent).toBe("");
    });
});

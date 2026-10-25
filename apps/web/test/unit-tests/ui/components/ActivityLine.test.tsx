import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadGameIconUrl, peekGameIconUrl } from "../../../../src/core/activity/activityIcons";
import { clearActivity, receiveActivity } from "../../../../src/core/activity/activityStore";
import type { ActivityIconFile } from "../../../../src/core/activity/activityWire";
import {
    ActivityIcon,
    ActivityLine,
    activityText,
    formatPlayingFor,
} from "../../../../src/ui/components/activity/ActivityLine";

vi.mock("../../../../src/core/activity/activityIcons", () => ({
    clearGameIconUrls: vi.fn(),
    loadGameIconUrl: vi.fn(),
    peekGameIconUrl: vi.fn(),
    rememberedGameIcon: vi.fn(),
    uploadGameIcon: vi.fn(),
}));

const WOW = { id: "wow", name: "World of Warcraft" };
const ICON: ActivityIconFile = {
    url: "mxc://s/dota",
    key: { kty: "oct", alg: "A256CTR", k: "a".repeat(43), key_ops: ["encrypt", "decrypt"], ext: true },
    iv: "b".repeat(22),
    hashes: { sha256: "c".repeat(43) },
    v: "v2",
};
const DOTA = { id: "steam-570", name: "Dota 2", icon: ICON };
const client = {} as never;

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

    it("shows the game's own icon once it has loaded, and the controller until then", async () => {
        let finish: (url: string | null) => void = () => undefined;
        vi.mocked(loadGameIconUrl).mockReturnValue(new Promise((resolve) => (finish = resolve)));
        act(() => {
            root.render(
                <>
                    <ActivityLine client={client} userId="@bob:s" />
                    <ActivityIcon client={client} userId="@bob:s" />
                </>,
            );
            receiveActivity("@bob:s", "PC", { game: DOTA, startedAt: Date.now(), expiresAt: Date.now() + 60_000 }, Date.now());
        });
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain("\uD83C\uDFAE");
        expect(loadGameIconUrl).toHaveBeenCalledWith(client, ICON);

        await act(async () => finish("blob:dota"));
        const icons = [...container.querySelectorAll("img.activity-game-icon")];
        expect(icons.map((icon) => icon.getAttribute("src"))).toEqual(["blob:dota", "blob:dota"]);
        expect(container.textContent).not.toContain("\uD83C\uDFAE");
        expect(container.querySelector(".activity-icon")?.getAttribute("aria-label")).toBe("Playing Dota 2");
    });

    it("keeps the controller when the icon can't be shown", async () => {
        vi.mocked(peekGameIconUrl).mockReturnValue(null);
        act(() => {
            root.render(<ActivityLine client={client} userId="@bob:s" />);
            receiveActivity("@bob:s", "PC", { game: DOTA, startedAt: Date.now(), expiresAt: Date.now() + 60_000 }, Date.now());
        });
        await act(async () => undefined);
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toBe("\uD83C\uDFAEPlaying Dota 2");
        expect(loadGameIconUrl).not.toHaveBeenCalled();
    });
});

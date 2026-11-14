import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearActivity, receiveActivity } from "../../../../src/core/activity/activityStore";
import { DmStatusLine } from "../../../../src/ui/components/DmStatusLine";

vi.mock("../../../../src/core/activity/activityIcons", () => ({
    clearGameIconUrls: vi.fn(),
    loadGameIconUrl: vi.fn(),
    peekGameIconUrl: vi.fn(),
    rememberedGameIcon: vi.fn(),
    uploadGameIcon: vi.fn(),
}));

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
    vi.restoreAllMocks();
});

function render(statusMessage: string | null): void {
    act(() => root.render(<DmStatusLine userId="@bob:s" statusMessage={statusMessage} />));
}

describe("DmStatusLine", () => {
    it("renders nothing without a game or a status, so the row stays one line", () => {
        render(null);
        expect(container.innerHTML).toBe("");
        render("   ");
        expect(container.innerHTML).toBe("");
    });

    it("shows the status message, with the full text as a tooltip", () => {
        const long = "a very long status message that will not fit in the narrow list at all";
        render(long);
        const line = container.querySelector(".room-item-status");
        expect(line?.textContent).toBe(long);
        expect(line?.getAttribute("title")).toBe(long);
        expect(container.querySelector("[role=link]")).toBeNull();
    });

    it("puts a shared game ahead of the status message", () => {
        render("back in 5");
        act(() => {
            receiveActivity("@bob:s", "PC", { game: WOW, startedAt: Date.now(), expiresAt: Date.now() + 60_000 }, Date.now());
        });
        const line = container.querySelector(".room-item-status");
        expect(line?.classList.contains("is-activity")).toBe(true);
        expect(line?.textContent).toContain("Playing World of Warcraft");
        expect(line?.textContent).not.toContain("back in 5");

        act(() => {
            receiveActivity("@bob:s", "PC", { game: null }, Date.now());
        });
        expect(container.textContent).toBe("back in 5");
    });

    it("opens a status that is a web address, without opening the chat", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        const rowClick = vi.fn();
        act(() =>
            root.render(
                <button type="button" onClick={rowClick}>
                    <DmStatusLine userId="@bob:s" statusMessage="twitch.tv/bob" />
                </button>,
            ),
        );
        const link = container.querySelector<HTMLElement>("[role=link]");
        expect(link?.textContent).toBe("twitch.tv/bob");
        act(() => link?.click());
        expect(open).toHaveBeenCalledWith("https://twitch.tv/bob", "_blank", "noopener,noreferrer");
        expect(rowClick).not.toHaveBeenCalled();
    });
});

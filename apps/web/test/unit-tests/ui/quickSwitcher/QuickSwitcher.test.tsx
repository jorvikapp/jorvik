import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickSwitcher } from "../../../../src/ui/quickSwitcher/QuickSwitcher";
import type { QuickSwitcherItem } from "../../../../src/ui/quickSwitcher/quickSwitcherSearch";

let container: HTMLDivElement;
let root: Root;

const ITEMS: QuickSwitcherItem[] = [
    { roomId: "!general", kind: "channel", name: "general", detail: "Ops", keywords: [], lastActive: 30, unread: true, count: 2, avatarSources: [], avatarSeed: "!general" },
    { roomId: "!random", kind: "channel", name: "random", detail: "Ops", keywords: [], lastActive: 20, unread: false, count: 0, avatarSources: [], avatarSeed: "!random" },
    { roomId: "!riff", kind: "dm", name: "Riff", detail: "@riff", keywords: ["@riff"], lastActive: 10, unread: false, count: 0, avatarSources: [], avatarSeed: "@riff:matrix.jorvik.app" },
];

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout, so nothing to scroll.
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

function render(onSelect = vi.fn(), onClose = vi.fn()) {
    act(() => {
        root.render(<QuickSwitcher items={ITEMS} currentRoomId={null} onSelect={onSelect} onClose={onClose} />);
    });
    return { onSelect, onClose, input: container.querySelector(".quick-switcher-input") as HTMLInputElement };
}

function type(input: HTMLInputElement, value: string): void {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function press(input: HTMLInputElement, key: string): void {
    act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

const optionNames = () => [...container.querySelectorAll(".quick-switcher-option .quick-switcher-name")].map((node) => node.textContent);

describe("QuickSwitcher", () => {
    it("opens with the search box focused and recent conversations listed", () => {
        const { input } = render();
        expect(document.activeElement).toBe(input);
        expect(optionNames()).toEqual(["general", "random", "Riff"]);
        expect(container.querySelector(".quick-switcher-option.is-unread .quick-switcher-count")?.textContent).toBe("2");
    });

    it("goes to the chosen conversation with the arrows and Enter", () => {
        const { input, onSelect } = render();
        press(input, "ArrowDown");
        press(input, "ArrowDown");
        expect(input.getAttribute("aria-activedescendant")).toBe("quick-switcher-option-2");
        press(input, "Enter");
        expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
        press(input, "ArrowDown");
        press(input, "Enter");
        expect(onSelect).toHaveBeenLastCalledWith(ITEMS[0]);
    });

    it("narrows the list as you type and starts again from the top", () => {
        const { input, onSelect } = render();
        press(input, "ArrowDown");
        type(input, "ran");
        expect(optionNames()).toEqual(["random"]);
        press(input, "Enter");
        expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
        type(input, "zzz");
        expect(container.querySelector(".quick-switcher-empty")?.textContent).toBe("Nothing by that name.");
    });

    it("closes with Escape or a click outside, and gives focus back", () => {
        const button = document.createElement("button");
        document.body.appendChild(button);
        button.focus();
        const { input, onClose } = render();
        press(input, "Escape");
        expect(onClose).toHaveBeenCalledTimes(1);
        act(() => {
            container.querySelector(".quick-switcher-overlay")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(2);
        act(() => {
            root.unmount();
        });
        root = createRoot(container);
        expect(document.activeElement).toBe(button);
        button.remove();
    });

    it("goes to a conversation that is clicked", () => {
        const { onSelect } = render();
        act(() => {
            (container.querySelectorAll(".quick-switcher-option")[1] as HTMLElement).click();
        });
        expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
    });
});

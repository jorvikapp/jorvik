import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { placeMenu, UserContextMenu } from "../../../../src/ui/components/user/UserContextMenu";
import type { UserMenuEntry } from "../../../../src/ui/users/userMenus";

let container: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;
let ran: string[];
let onClose: ReturnType<typeof vi.fn>;

const entries = (): UserMenuEntry[] => [
    { kind: "item", id: "profile", label: "Profile", run: () => ran.push("profile") },
    { kind: "item", id: "message", label: "Message", run: () => ran.push("message") },
    { kind: "separator", id: "sep" },
    { kind: "item", id: "block", label: "Block", tone: "danger", run: () => ran.push("block") },
    { kind: "separator", id: "sep-mod" },
    { kind: "label", id: "mods", label: "Moderators only" },
    { kind: "item", id: "remove", label: "Remove from space", tone: "warning", run: () => ran.push("remove") },
    { kind: "item", id: "ban", label: "Ban from space", tone: "danger", run: () => ran.push("ban") },
];

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    opener = document.createElement("button");
    opener.textContent = "Riff";
    document.body.appendChild(opener);
    opener.focus();
    root = createRoot(container);
    ran = [];
    onClose = vi.fn();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    opener.remove();
    vi.restoreAllMocks();
});

function open(point = { x: 100, y: 100 }): void {
    act(() => {
        root.render(<UserContextMenu point={point} label="Options for Riff" entries={entries()} onClose={onClose} />);
    });
}
const menu = (): HTMLElement => document.querySelector<HTMLElement>('.user-menu[role="menu"]')!;
const item = (label: string): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === label)!;
const key = (name: string, extra: KeyboardEventInit = {}): void => {
    act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));
    });
};

describe("roles and labels", () => {
    it("is a labelled menu of menu items, with separators and the moderators' items as a labelled group", () => {
        open();
        expect(menu().getAttribute("aria-label")).toBe("Options for Riff");
        expect([...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent)).toEqual([
            "Profile",
            "Message",
            "Block",
            "Remove from space",
            "Ban from space",
        ]);
        expect(document.querySelectorAll('[role="separator"]')).toHaveLength(2);
        const group = document.querySelector('[role="group"]')!;
        expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe("Moderators only");
        expect(group.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
        expect(item("Block").className).toContain("is-danger");
        expect(item("Remove from space").className).toContain("is-warning");
    });
});

describe("the keyboard", () => {
    it("starts on the first item; arrows move and wrap; Home and End; Tab stays inside", () => {
        open();
        expect(document.activeElement).toBe(item("Profile"));
        key("ArrowDown");
        expect(document.activeElement).toBe(item("Message"));
        key("ArrowUp");
        key("ArrowUp");
        expect(document.activeElement).toBe(item("Ban from space"));
        key("ArrowDown");
        expect(document.activeElement).toBe(item("Profile"));
        key("End");
        expect(document.activeElement).toBe(item("Ban from space"));
        key("Home");
        expect(document.activeElement).toBe(item("Profile"));
        key("Tab");
        expect(document.activeElement).toBe(item("Message"));
        key("Tab", { shiftKey: true });
        key("Tab", { shiftKey: true });
        expect(document.activeElement).toBe(item("Ban from space"));
        expect(menu().contains(document.activeElement)).toBe(true);
    });

    it("Enter runs the item and closes the menu", () => {
        open();
        key("ArrowDown");
        key("Enter");
        expect(ran).toEqual(["message"]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("Escape closes it and puts focus back where it was", () => {
        open();
        key("Escape");
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(ran).toEqual([]);
        expect(document.activeElement).toBe(opener);
    });
});

describe("closing", () => {
    it("closes when an item is chosen, then runs it", () => {
        open();
        act(() => item("Block").click());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(ran).toEqual(["block"]);
    });

    it("closes on a click outside, a scroll, the window losing focus or being resized; not on a click inside", () => {
        open();
        act(() => {
            item("Profile").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        // The stray mousedown a phone sends after a long press isn't a click outside.
        act(() => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        for (const happen of [
            () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
            () => document.dispatchEvent(new Event("scroll")),
            () => window.dispatchEvent(new Event("blur")),
            () => window.dispatchEvent(new Event("resize")),
        ]) {
            onClose.mockClear();
            act(() => happen());
            expect(onClose).toHaveBeenCalledTimes(1);
        }
    });
});

describe("staying on the screen", () => {
    const size = { width: 220, height: 300 };

    it("opens at the point when there's room", () => {
        expect(placeMenu({ x: 100, y: 100 }, size, { width: 1280, height: 800 })).toEqual({ x: 100, y: 100 });
    });

    it("opens leftwards near the right edge and upwards near the bottom", () => {
        expect(placeMenu({ x: 1200, y: 700 }, size, { width: 1280, height: 800 })).toEqual({ x: 980, y: 400 });
    });

    it("never leaves the screen, even when it barely fits: a phone, pressed in the corner", () => {
        for (const point of [
            { x: 385, y: 840 },
            { x: 2, y: 2 },
            { x: 200, y: 830 },
            { x: 380, y: 10 },
        ]) {
            const placed = placeMenu(point, size, { width: 390, height: 844 });
            expect(placed.x).toBeGreaterThanOrEqual(8);
            expect(placed.y).toBeGreaterThanOrEqual(8);
            expect(placed.x + size.width).toBeLessThanOrEqual(390 - 8);
            expect(placed.y + size.height).toBeLessThanOrEqual(844 - 8);
        }
    });

    it("measures itself and moves into view when opened near the bottom-right", () => {
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(220);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300);
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
        open({ x: 380, y: 830 });
        expect(menu().style.left).toBe("160px");
        expect(menu().style.top).toBe("530px");
        expect(menu().style.visibility).toBe("visible");
    });
});

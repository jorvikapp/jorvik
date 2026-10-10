import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailContextMenu } from "../../../../src/ui/components/RailContextMenu";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

const menuItem = (): HTMLButtonElement | null =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(".message-context-menu button")).find(
        (button) => button.textContent === "Mark all as read",
    ) ?? null;

describe("RailContextMenu", () => {
    it("marks everything read from its one item, then closes", async () => {
        const onMarkAllRead = vi.fn();
        const onClose = vi.fn();
        await act(async () => {
            root.render(<RailContextMenu position={{ x: 20, y: 40 }} onMarkAllRead={onMarkAllRead} onClose={onClose} />);
        });

        await act(async () => {
            menuItem()?.click();
        });
        expect(onMarkAllRead).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });

    it("closes on Escape or a click elsewhere, without marking anything", async () => {
        const onMarkAllRead = vi.fn();
        const onClose = vi.fn();
        await act(async () => {
            root.render(<RailContextMenu position={{ x: 20, y: 40 }} onMarkAllRead={onMarkAllRead} onClose={onClose} />);
        });

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        await act(async () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(onMarkAllRead).not.toHaveBeenCalled();
    });

    it("shows nothing until it has somewhere to open", async () => {
        await act(async () => {
            root.render(<RailContextMenu position={null} onMarkAllRead={() => undefined} onClose={() => undefined} />);
        });
        expect(menuItem()).toBeNull();
    });
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileHeader } from "../../../../src/ui/components/rightPanel/ProfileHeader";

let container: HTMLDivElement;
let root: Root;

// Lays the panel out as measured in a 1000px window (panel from x=762) or a 1280px one
// (panel from x=1002), with the menu hanging left from the button.
function layout(panelLeft: number, menuLeft: number): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const left = this.classList.contains("rp-profile-menu-panel")
            ? menuLeft
            : this.classList.contains("panel-scroller")
              ? panelLeft
              : 0;
        return { left, right: left + 170, top: 0, bottom: 20, width: 170, height: 20, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
}

async function openMenu(): Promise<HTMLElement | null> {
    await act(async () => {
        root.render(
            <ProfileHeader
                displayName="bob"
                userId="@bob:test.local"
                avatarSources={[]}
                presence={null}
                onBack={vi.fn()}
                onCopyMxid={vi.fn(async () => undefined)}
                onCopyUserId={vi.fn(async () => undefined)}
            />,
        );
    });
    await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
    });
    return container.querySelector<HTMLElement>(".rp-profile-menu-panel");
}

describe("ProfileHeader menu", () => {
    beforeEach(() => {
        // The right panel scrolls, so it clips the menu.
        container = document.createElement("div");
        container.className = "panel-scroller";
        container.style.overflowX = "auto";
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it("hangs right when hanging left would be cut off by the panel", async () => {
        layout(762, 649);
        const menu = await openMenu();
        expect(menu?.classList.contains("is-hanging-right")).toBe(true);
    });

    it("hangs left from the button when there is room", async () => {
        layout(1002, 1065);
        const menu = await openMenu();
        expect(menu).not.toBeNull();
        expect(menu?.classList.contains("is-hanging-right")).toBe(false);
    });
});

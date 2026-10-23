import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrivacyTab } from "../../../../src/ui/settings/user/tabs/PrivacyTab";
import type { PrivacySettings } from "../../../../src/ui/settings/user/settingsStore";

let container: HTMLDivElement;
let root: Root;

const SETTINGS: PrivacySettings = {
    showReadReceipts: true,
    allowDmsFromServerMembers: true,
    autoIdleMinutes: 10,
    linkPreviewsInEncrypted: true,
    shareGameActivity: false,
};

function client() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        getIgnoredUsers: () => [],
        getDomain: () => "example.org",
        removeListener: emitter.removeListener.bind(emitter),
    });
}

async function render(onChange = vi.fn()): Promise<void> {
    await act(async () => {
        root.render(<PrivacyTab client={client() as never} onToast={() => undefined} settings={SETTINGS} onChange={onChange} />);
    });
}

function gameToggle(): HTMLInputElement {
    const label = [...container.querySelectorAll("label")].find((l) => l.textContent?.includes("Show the game I'm playing"));
    if (!label) throw new Error("no game activity toggle");
    return label.querySelector("input")!;
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.heorotDesktop;
});

describe("PrivacyTab game activity", () => {
    it("is off by default and turns on in the desktop app", async () => {
        window.heorotDesktop = { setGameActivityEnabled: async () => null, gameActivitySupported: async () => true };
        const onChange = vi.fn();
        await render(onChange);

        expect(gameToggle().checked).toBe(false);
        expect(gameToggle().disabled).toBe(false);
        act(() => gameToggle().click());
        expect(onChange).toHaveBeenCalledWith({ ...SETTINGS, shareGameActivity: true });
    });

    it("can't be turned on in a browser, and says why", async () => {
        await render();

        expect(gameToggle().disabled).toBe(true);
        expect(container.textContent).toContain("Only the desktop app can see which game you're playing.");
    });

    it("can't be turned on in the Flatpak and Snap versions, and says why", async () => {
        window.heorotDesktop = { setGameActivityEnabled: async () => null, gameActivitySupported: async () => false };
        await render();

        expect(gameToggle().disabled).toBe(true);
        expect(container.textContent).toContain("The Flatpak and Snap versions can't see other programs");
    });
});

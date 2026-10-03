import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppearanceSettings } from "../../../../src/ui/settings/user/settingsStore";
import { AppearanceTab } from "../../../../src/ui/settings/user/tabs/AppearanceTab";

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
    delete (window as { heorotDesktop?: unknown }).heorotDesktop;
});

const settings: AppearanceSettings = {
    theme: "dark",
    compactMode: false,
    showTimestamps: true,
    closeOnWindowCloseMinimize: true,
    developerToolsEnabled: false,
    chatLineLengthCh: 0,
    showSpaceChannelAvatars: false,
};

function renderTab(onChange = vi.fn()) {
    act(() => {
        root.render(
            <AppearanceTab settings={settings} renderReactionImages onToggleRenderReactionImages={() => {}} onChange={onChange} />,
        );
    });
    return onChange;
}

function devToolsToggle(): HTMLInputElement | null {
    const label = [...container.querySelectorAll("label")].find((el) => el.textContent?.includes("Developer tools"));
    return label?.querySelector("input") ?? null;
}

describe("AppearanceTab developer tools", () => {
    it("is not offered in a browser, where the app can't control them", () => {
        renderTab();
        expect(devToolsToggle()).toBeNull();
    });

    it("is off by default in the desktop app and turns on from its toggle", () => {
        (window as { heorotDesktop?: unknown }).heorotDesktop = { platform: "linux" };
        const onChange = renderTab();
        const toggle = devToolsToggle();
        expect(toggle?.checked).toBe(false);
        expect(container.textContent).toContain("Ctrl+Shift+I");

        act(() => {
            toggle!.click();
        });
        expect(onChange).toHaveBeenCalledWith({ ...settings, developerToolsEnabled: true });
    });

    it("names the macOS shortcut on a Mac", () => {
        (window as { heorotDesktop?: unknown }).heorotDesktop = { platform: "darwin" };
        renderTab();
        expect(container.textContent).toContain("Cmd+Shift+I");
    });
});

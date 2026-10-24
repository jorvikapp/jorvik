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

async function render(onOpenActivityPrivacy = vi.fn()): Promise<void> {
    await act(async () => {
        root.render(
            <PrivacyTab
                client={client() as never}
                onToast={() => undefined}
                settings={SETTINGS}
                onChange={vi.fn()}
                onOpenActivityPrivacy={onOpenActivityPrivacy}
            />,
        );
    });
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
    // 1.0.27 had a "Show the game I'm playing" switch here; who sees the game now has its own page.
    it("has no game switch of its own, and leads to Activity Privacy", async () => {
        const onOpenActivityPrivacy = vi.fn();
        await render(onOpenActivityPrivacy);

        expect(container.textContent).not.toContain("Show the game I'm playing");
        const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Activity Privacy");
        act(() => button!.click());
        expect(onOpenActivityPrivacy).toHaveBeenCalled();
    });
});

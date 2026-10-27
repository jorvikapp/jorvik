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
    autoIdleMinutes: 10,
    linkPreviewsInEncrypted: true,
    shareGameActivity: false,
};

function client({ privateReceipts = true, saved = undefined as unknown, saveFails = false } = {}) {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        getIgnoredUsers: () => [],
        getDomain: () => "example.org",
        getAccountData: (type: string) =>
            type === "app.jorvik.read_receipts" && saved !== undefined ? { getContent: () => saved } : undefined,
        setAccountData: vi.fn(async () => {
            if (saveFails) {
                throw new Error("offline");
            }
            return {};
        }),
        isVersionSupported: async () => privateReceipts,
        doesServerSupportUnstableFeature: async () => false,
        removeListener: emitter.removeListener.bind(emitter),
    });
}

async function render(onOpenActivityPrivacy = vi.fn(), c = client(), onToast = vi.fn()): Promise<void> {
    await act(async () => {
        root.render(
            <PrivacyTab
                client={c as never}
                onToast={onToast}
                settings={SETTINGS}
                onChange={vi.fn()}
                onOpenActivityPrivacy={onOpenActivityPrivacy}
            />,
        );
    });
}

function toggle(label: string): HTMLInputElement {
    const row = [...container.querySelectorAll("label.settings-toggle")].find((l) => l.textContent?.trim() === label);
    return row!.querySelector("input")!;
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

describe("PrivacyTab read receipts", () => {
    it("says what each switch does, with no placeholders left", async () => {
        await render();

        const text = container.textContent ?? "";
        for (const gone of ["(stub)", "TODO", "placeholder", "Allow DMs from server members"]) {
            expect(text).not.toContain(gone);
        }
        expect(toggle("Send read receipts").checked).toBe(true);
        expect(toggle("Show read receipts in direct messages").checked).toBe(true);
    });

    it("keeps them private on every device when Send read receipts is turned off", async () => {
        const c = client();
        await render(vi.fn(), c);

        await act(async () => toggle("Send read receipts").click());
        expect(c.setAccountData).toHaveBeenCalledWith("app.jorvik.read_receipts", { private: true });
        expect(toggle("Send read receipts").checked).toBe(false);

        // Turned back on from another device.
        act(() => {
            c.emit("accountData", { getType: () => "app.jorvik.read_receipts", getContent: () => ({ private: false }) });
        });
        expect(toggle("Send read receipts").checked).toBe(true);
    });

    it("shows the saved choice again if it can't be saved", async () => {
        const onToast = vi.fn();
        await render(vi.fn(), client({ saveFails: true }), onToast);

        await act(async () => toggle("Send read receipts").click());
        expect(toggle("Send read receipts").checked).toBe(true);
        expect(onToast).toHaveBeenCalledWith({ type: "error", message: "Could not change read receipts. Try again." });
    });

    it("can't be turned off where the server can't keep them private", async () => {
        await render(vi.fn(), client({ privateReceipts: false }));

        expect(toggle("Send read receipts").disabled).toBe(true);
        expect(container.textContent).toContain("Your server can't keep read receipts private, so they're always sent.");
    });

    it("starts off when the account already keeps them private", async () => {
        await render(vi.fn(), client({ saved: { private: true } }));
        expect(toggle("Send read receipts").checked).toBe(false);
    });
});

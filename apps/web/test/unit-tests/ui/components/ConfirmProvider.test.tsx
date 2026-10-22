import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const phone = vi.hoisted(() => ({ value: false }));
vi.mock("../../../../src/ui/layout/phoneLayout", () => ({ usePhoneLayout: () => phone.value }));
vi.mock("../../../../src/ui/layout/phoneBackStack", () => ({ usePhoneBackLayer: () => undefined }));

import { ConfirmProvider, useConfirm, type ConfirmFn } from "../../../../src/ui/components/confirm/ConfirmProvider";

let container: HTMLDivElement;
let root: Root;
let ask: ConfirmFn;

function Probe(): null {
    ask = useConfirm();
    return null;
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

async function render(withProvider = true): Promise<void> {
    await act(async () => {
        root.render(withProvider ? <ConfirmProvider><Probe /></ConfirmProvider> : <Probe />);
    });
}

// Wrapped, because an async function returning the answer itself would wait for it.
async function askSignOut(): Promise<{ answer: Promise<boolean> }> {
    let answer!: Promise<boolean>;
    await act(async () => {
        answer = ask({ title: "Sign out of this session?", confirmLabel: "Sign out", danger: true });
    });
    return { answer };
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    phone.value = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
});

describe("ConfirmProvider", () => {
    it("asks in its own dialog, never through the browser's confirm()", async () => {
        // A browser that never shows confirm() answers "no" straight away.
        const browserConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        await render();
        const { answer } = await askSignOut();

        expect(document.body.textContent).toContain("Sign out of this session?");
        await act(async () => {
            buttonNamed("Sign out")?.click();
        });

        await expect(answer).resolves.toBe(true);
        expect(browserConfirm).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain("Sign out of this session?");
    });

    it("answers no when cancelled", async () => {
        await render();
        const { answer } = await askSignOut();
        await act(async () => {
            buttonNamed("Cancel")?.click();
        });
        await expect(answer).resolves.toBe(false);
    });

    it("cancels a question that a newer one replaces", async () => {
        await render();
        const { answer: first } = await askSignOut();
        let second!: Promise<boolean>;
        await act(async () => {
            second = ask({ title: "Delete this message?", confirmLabel: "Delete", danger: true });
        });

        await expect(first).resolves.toBe(false);
        expect(document.body.textContent).toContain("Delete this message?");
        await act(async () => {
            buttonNamed("Delete")?.click();
        });
        await expect(second).resolves.toBe(true);
    });

    it("uses a sheet from the bottom on phones", async () => {
        phone.value = true;
        await render();
        const { answer } = await askSignOut();

        const sheet = document.body.querySelector(".bottom-sheet.confirm-sheet");
        expect(sheet?.textContent).toContain("Sign out of this session?");
        expect(buttonNamed("Sign out")?.className).toContain("sheet-item-danger");
        await act(async () => {
            buttonNamed("Sign out")?.click();
        });
        await expect(answer).resolves.toBe(true);
        expect(document.body.querySelector(".confirm-sheet")).toBeNull();
    });

    it("falls back to the browser's confirm() outside a provider", async () => {
        const browserConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
        await render(false);
        await expect(ask({ title: "Leave “general”?", confirmLabel: "Leave" })).resolves.toBe(true);
        expect(browserConfirm).toHaveBeenCalledWith("Leave “general”?");
    });
});

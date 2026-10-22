import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "../../../../src/ui/components/confirm/ConfirmProvider";
import { SignOutTab } from "../../../../src/ui/settings/user/tabs/SignOutTab";

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
    vi.restoreAllMocks();
});

function buttonNamed(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

async function renderTab(onSignOut: () => Promise<void>): Promise<void> {
    await act(async () => {
        root.render(
            <ConfirmProvider>
                <SignOutTab onSignOut={onSignOut} />
            </ConfirmProvider>,
        );
    });
}

describe("SignOutTab", () => {
    // A browser that blocks confirm() answers "no" without asking, so Sign out did nothing.
    it("signs out where the browser's own confirm box never appears", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(false);
        const onSignOut = vi.fn().mockResolvedValue(undefined);
        await renderTab(onSignOut);

        await act(async () => {
            buttonNamed("Sign out")?.click();
        });
        expect(document.body.textContent).toContain("Sign out of this session?");
        const confirmButton = Array.from(document.body.querySelectorAll(".room-dialog-footer button")).find(
            (button) => button.textContent?.trim() === "Sign out",
        ) as HTMLButtonElement | undefined;
        await act(async () => {
            confirmButton?.click();
        });

        expect(onSignOut).toHaveBeenCalledTimes(1);
    });

    it("stays signed in when the question is cancelled", async () => {
        const onSignOut = vi.fn().mockResolvedValue(undefined);
        await renderTab(onSignOut);

        await act(async () => {
            buttonNamed("Sign out")?.click();
        });
        await act(async () => {
            buttonNamed("Cancel")?.click();
        });

        expect(onSignOut).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain("Sign out of this session?");
    });
});

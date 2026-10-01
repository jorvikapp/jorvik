import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecurityRecoveryView } from "../../../../src/ui/components/SecurityRecoveryView";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function renderSetup(onCompleteSetup = vi.fn(async () => undefined)) {
    act(() => {
        root.render(
            <SecurityRecoveryView
                flow="setup"
                error={null}
                onPrepareSetup={async () => "EsTc 1234"}
                onCompleteSetup={onCompleteSetup}
                onRestore={vi.fn()}
                onCompleteCrossSigning={vi.fn()}
                onSkip={vi.fn()}
                accountLabel="@lilith"
            />,
        );
    });
    return onCompleteSetup;
}

const button = (label: string): HTMLButtonElement =>
    [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;

describe("SecurityRecoveryView key prompts", () => {
    it.each(["restore", "cross_signing"] as const)("%s says what to do about a lost key", (flow) => {
        act(() => {
            root.render(
                <SecurityRecoveryView
                    flow={flow}
                    error={null}
                    onPrepareSetup={vi.fn()}
                    onCompleteSetup={vi.fn()}
                    onRestore={vi.fn()}
                    onCompleteCrossSigning={vi.fn()}
                    onSkip={vi.fn()}
                />,
            );
        });
        expect(container.textContent).toContain("Lost your security key? Skip for now, then make a new one in Settings under Encryption.");
    });
});

describe("SecurityRecoveryView setup", () => {
    it("says a new key is not saved yet, and why Finish is greyed out", async () => {
        renderSetup();
        await act(async () => button("Generate security key").click());

        expect(container.textContent).toContain("New security key, not saved yet");
        expect(container.textContent).toContain("Until then it isn't your account's key.");
        expect(container.textContent).toContain("Copy or download the key first.");
        expect(button("Finish setup").disabled).toBe(true);
    });

    it("lets a key copied by hand finish setup", async () => {
        const onCompleteSetup = renderSetup();
        await act(async () => button("Generate security key").click());

        await act(async () => {
            container.querySelector("code")!.dispatchEvent(new Event("copy", { bubbles: true }));
        });
        expect(container.textContent).not.toContain("Copy or download the key first.");
        expect(button("Finish setup").disabled).toBe(false);

        await act(async () => button("Finish setup").click());
        expect(onCompleteSetup).toHaveBeenCalledOnce();
    });

    it("downloads the key under the account's name and the day", async () => {
        const names: string[] = [];
        URL.createObjectURL = vi.fn(() => "blob:key");
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            names.push(this.download);
        });
        renderSetup();
        await act(async () => button("Generate security key").click());
        await act(async () => button("Download .txt").click());

        expect(names).toHaveLength(1);
        expect(names[0]).toMatch(/^jorvik-security-key-lilith-\d{4}-\d{2}-\d{2}\.txt$/);
        expect(button("Finish setup").disabled).toBe(false);
    });
});

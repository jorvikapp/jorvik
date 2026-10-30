import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachPicker, shouldUseAttachMenu, type AttachPickerHandle } from "../../../../src/ui/components/composer/AttachPicker";

const ANDROID = "Mozilla/5.0 (Linux; Android 15; CPH2581) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

let container: HTMLDivElement;
let root: Root;
let opened: HTMLInputElement[];

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // Records which picker was asked to open, since jsdom has no picker to show.
    opened = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        opened.push(this);
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (navigator as { userAgent?: string }).userAgent;
    delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

async function renderPicker(asMenu: boolean, onFiles = vi.fn()): Promise<React.RefObject<AttachPickerHandle | null>> {
    const ref = React.createRef<AttachPickerHandle>();
    await act(async () => {
        root.render(<AttachPicker ref={ref} asMenu={asMenu} disabled={false} onFiles={onFiles} />);
    });
    return ref;
}

function menu(): HTMLElement | null {
    return document.body.querySelector('[role="dialog"][aria-label="Add to your message"]');
}

async function choose(ref: React.RefObject<AttachPickerHandle | null>, label: string): Promise<HTMLInputElement> {
    await act(async () => {
        ref.current?.open();
    });
    const item = Array.from(menu()?.querySelectorAll("button") ?? []).find((button) => button.textContent?.trim() === label);
    if (!item) {
        throw new Error(`expected a "${label}" choice`);
    }
    await act(async () => {
        item.click();
    });
    expect(menu()).toBeNull();
    return opened[opened.length - 1];
}

describe("AttachPicker", () => {
    it("on phones, opens a menu whose choices each open the matching picker", async () => {
        const ref = await renderPicker(true);

        const photos = await choose(ref, "Photos and videos");
        expect(photos.accept).toBe("image/*,video/*");
        expect(photos.multiple).toBe(true);

        const camera = await choose(ref, "Take a photo");
        expect(camera.accept).toBe("image/*");
        expect(camera.getAttribute("capture")).toBe("environment");

        const files = await choose(ref, "Files");
        expect(files.accept).toBe("");
        expect(files.multiple).toBe(true);
        expect(opened).toHaveLength(3);
    });

    it("elsewhere, goes straight to the file picker", async () => {
        const ref = await renderPicker(false);

        await act(async () => {
            ref.current?.open();
        });

        expect(menu()).toBeNull();
        expect(opened).toHaveLength(1);
        expect(opened[0].accept).toBe("");
        expect(container.querySelectorAll("input")).toHaveLength(1);
    });

    it("hands over the picked files, then clears the picker so the same file can be picked again", async () => {
        const onFiles = vi.fn();
        await renderPicker(true, onFiles);
        const photoInput = container.querySelector('input[accept="image/*,video/*"]') as HTMLInputElement;
        const picture = new File(["x"], "longship.jpg", { type: "image/jpeg" });
        let valueSetTo: string | null = null;
        Object.defineProperty(photoInput, "files", { configurable: true, value: [picture] });
        Object.defineProperty(photoInput, "value", {
            configurable: true,
            get: () => "",
            set: (value: string) => {
                valueSetTo = value;
            },
        });

        await act(async () => {
            photoInput.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(onFiles).toHaveBeenCalledWith([picture]);
        expect(valueSetTo).toBe("");
    });
});

describe("shouldUseAttachMenu", () => {
    function setDevice({ userAgent, touchPoints, coarse }: { userAgent: string; touchPoints: number; coarse: boolean }): void {
        Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
        Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: touchPoints });
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
    }

    it("uses the menu on touch phones", () => {
        setDevice({ userAgent: ANDROID, touchPoints: 5, coarse: true });
        expect(shouldUseAttachMenu(true)).toBe(true);
    });

    it("leaves iPhones to Apple's own menu", () => {
        setDevice({ userAgent: IPHONE, touchPoints: 5, coarse: true });
        expect(shouldUseAttachMenu(true)).toBe(false);
    });

    it("skips the menu in a narrow window on a computer, where there's no camera to open", () => {
        setDevice({ userAgent: ANDROID, touchPoints: 0, coarse: false });
        expect(shouldUseAttachMenu(true)).toBe(false);
    });

    it("skips the menu outside the phone layout", () => {
        setDevice({ userAgent: ANDROID, touchPoints: 5, coarse: true });
        expect(shouldUseAttachMenu(false)).toBe(false);
    });
});

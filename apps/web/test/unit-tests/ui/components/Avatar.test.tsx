import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Avatar } from "../../../../src/ui/components/Avatar";

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

/**
 * memberAvatarSources builds a new array on every call, so every parent render
 * hands Avatar a different array identity holding identical URLs.
 */
function render(urls: string[]): void {
    act(() => {
        root.render(<Avatar name="Alice" className="test-avatar" sources={[...urls]} />);
    });
}

function failCurrentImage(): void {
    const image = container.querySelector("img");
    if (!image) {
        throw new Error("expected an <img> to be rendered");
    }

    act(() => {
        image.dispatchEvent(new Event("error"));
    });
}

function currentSrc(): string | null {
    return container.querySelector("img")?.getAttribute("src") ?? null;
}

describe("Avatar", () => {
    it("falls through its sources as each one fails", () => {
        render(["http://host/a.png", "http://host/b.png"]);
        expect(currentSrc()).toBe("http://host/a.png");

        failCurrentImage();
        expect(currentSrc()).toBe("http://host/b.png");

        failCurrentImage();
        expect(currentSrc()).toBeNull();
        expect(container.querySelector(".avatar-fallback")?.textContent).toBe("A");
    });

    it("does not re-request exhausted sources when the parent re-renders", () => {
        render(["http://host/a.png", "http://host/b.png"]);
        failCurrentImage();
        failCurrentImage();
        expect(currentSrc()).toBeNull();

        // Same URLs, new array identity - previously this reset sourceIndex to
        // 0 and re-requested both failing URLs on every parent render.
        render(["http://host/a.png", "http://host/b.png"]);
        expect(currentSrc()).toBeNull();
        expect(container.querySelector(".avatar-fallback")?.textContent).toBe("A");
    });

    it("retries when the avatar URL genuinely changes", () => {
        render(["http://host/a.png"]);
        failCurrentImage();
        expect(currentSrc()).toBeNull();

        render(["http://host/changed.png"]);
        expect(currentSrc()).toBe("http://host/changed.png");
    });
});

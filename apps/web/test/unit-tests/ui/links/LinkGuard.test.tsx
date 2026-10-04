import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageRenderer } from "../../../../src/ui/components/MessageRenderer";
import { LinkGuardProvider } from "../../../../src/ui/links/LinkGuard";

let container: HTMLDivElement;
let root: Root;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    openSpy.mockRestore();
    window.localStorage.clear();
});

function render(formattedBody: string): void {
    act(() => {
        root.render(
            <LinkGuardProvider>
                <MessageRenderer body="fallback" format="org.matrix.custom.html" formattedBody={formattedBody} />
            </LinkGuardProvider>,
        );
    });
}

// Returns whether the click went through to the browser.
function click(element: Element, init: MouseEventInit = {}): boolean {
    let notCancelled = true;
    act(() => {
        notCancelled = element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    });
    return notCancelled;
}

const dialog = () => document.querySelector('[role="dialog"][aria-label="Open this link?"]');
const button = (label: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label) as HTMLButtonElement;

describe("LinkGuard", () => {
    it("opens a link that shows its own address straight away", () => {
        render('<a href="https://www.jorvik.app/download">https://www.jorvik.app/download</a>');
        expect(click(container.querySelector("a")!)).toBe(true);
        expect(dialog()).toBeNull();
    });

    it("asks before a masked link, shows the real site, and opens it only when asked", () => {
        render('<a href="https://evil.example/login?x=1">https://www.jorvik.app</a>');
        const link = container.querySelector("a")!;
        expect(link.getAttribute("title")).toBe("https://evil.example/login?x=1");
        expect(click(link)).toBe(false);
        expect(dialog()).not.toBeNull();
        expect(document.querySelector(".link-guard-url strong")?.textContent).toBe("evil.example");
        expect(document.querySelector(".link-guard-url")?.textContent).toBe("https://evil.example/login?x=1");
        expect(document.activeElement).toBe(button("Cancel"));
        click(button("Cancel"));
        expect(dialog()).toBeNull();
        expect(openSpy).not.toHaveBeenCalled();

        click(link);
        click(button("Open link"));
        expect(openSpy).toHaveBeenCalledWith("https://evil.example/login?x=1", "_blank", "noopener,noreferrer");
        expect(dialog()).toBeNull();
    });

    it("stops asking for a site once it's trusted", () => {
        render('<a href="https://www.jorvik.app/download">the download page</a>');
        const link = container.querySelector("a")!;
        click(link);
        click(document.querySelector(".link-guard-trust input")!);
        click(button("Open link"));
        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(click(link)).toBe(true);
        expect(dialog()).toBeNull();
    });

    it("asks on a middle click too", () => {
        render('<a href="https://evil.example/">Jorvik</a>');
        act(() => {
            container.querySelector("a")!.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
        });
        expect(dialog()).not.toBeNull();
    });

    it("doesn't make a link of an address with a user name in it", () => {
        render('<a href="https://www.jorvik.app@evil.example/">Jorvik</a>');
        expect(container.querySelector("a")).toBeNull();
        expect(container.textContent).toBe("Jorvik");
    });
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BackStackModule = typeof import("../../../../src/ui/layout/phoneBackStack");

let container: HTMLDivElement;
let root: Root;
let usePhoneBackLayer: BackStackModule["usePhoneBackLayer"];

function Layer({ open, onClose }: { open: boolean; onClose: () => void }): null {
    usePhoneBackLayer(open, onClose);
    return null;
}

function Layers({ chat, drawer, onCloseChat, onCloseDrawer }: {
    chat: boolean;
    drawer: boolean;
    onCloseChat: () => void;
    onCloseDrawer: () => void;
}): React.ReactElement {
    return (
        <>
            <Layer open={chat} onClose={onCloseChat} />
            <Layer open={chat && drawer} onClose={onCloseDrawer} />
        </>
    );
}

function render(element: React.ReactElement): void {
    act(() => {
        root.render(element);
    });
}

function goBack(): void {
    act(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
    });
}

beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // The stack lives at module level; each test gets a fresh one.
    vi.resetModules();
    ({ usePhoneBackLayer } = await import("../../../../src/ui/layout/phoneBackStack"));
    window.history.replaceState(null, "");
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

describe("usePhoneBackLayer", () => {
    it("keeps one history entry however many layers are open", () => {
        const push = vi.spyOn(window.history, "pushState");
        render(<Layers chat drawer={false} onCloseChat={vi.fn()} onCloseDrawer={vi.fn()} />);
        expect(push).toHaveBeenCalledTimes(1);

        render(<Layers chat drawer onCloseChat={vi.fn()} onCloseDrawer={vi.fn()} />);
        expect(push).toHaveBeenCalledTimes(1);
    });

    it("closes only the top layer on back, and keeps an entry for the next one", () => {
        const closeChat = vi.fn();
        const closeDrawer = vi.fn();
        render(<Layers chat drawer onCloseChat={closeChat} onCloseDrawer={closeDrawer} />);
        const push = vi.spyOn(window.history, "pushState");

        goBack();
        expect(closeDrawer).toHaveBeenCalledTimes(1);
        expect(closeChat).not.toHaveBeenCalled();
        expect(push).toHaveBeenCalledTimes(1);

        render(<Layers chat drawer={false} onCloseChat={closeChat} onCloseDrawer={closeDrawer} />);
        goBack();
        expect(closeChat).toHaveBeenCalledTimes(1);
    });

    it("takes its entry back off the history when the page closes the last layer itself", () => {
        const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
        const closeChat = vi.fn();
        render(<Layers chat drawer={false} onCloseChat={closeChat} onCloseDrawer={vi.fn()} />);

        render(<Layers chat={false} drawer={false} onCloseChat={closeChat} onCloseDrawer={vi.fn()} />);
        expect(back).toHaveBeenCalledTimes(1);

        // The pop that history.back() causes is ours, not the user's: it closes nothing.
        render(<Layers chat drawer={false} onCloseChat={closeChat} onCloseDrawer={vi.fn()} />);
        goBack();
        expect(closeChat).not.toHaveBeenCalled();
        goBack();
        expect(closeChat).toHaveBeenCalledTimes(1);
    });
});

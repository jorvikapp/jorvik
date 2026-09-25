import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RightSidebarMode } from "../../../../src/ui/components/rightPanel/types";
import { useRightSidebarMode } from "../../../../src/ui/components/rightPanel/useRightSidebarMode";

let container: HTMLDivElement;
let root: Root;
let current: { mode: RightSidebarMode; setMode: (mode: RightSidebarMode) => void };

function Probe({ isDirect }: { isDirect: boolean }): null {
    const [mode, setMode] = useRightSidebarMode(isDirect);
    current = { mode, setMode };
    return null;
}

function show(isDirect: boolean): RightSidebarMode {
    act(() => {
        root.render(<Probe isDirect={isDirect} />);
    });
    return current.mode;
}

function choose(mode: RightSidebarMode): void {
    act(() => {
        current.setMode(mode);
    });
}

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

describe("useRightSidebarMode", () => {
    it("closing the profile in a DM leaves the member list open in a space", () => {
        expect(show(true)).toBe("members");
        choose("closed");
        expect(show(false)).toBe("members");
        expect(show(true)).toBe("closed");
    });

    it("closing the member list in a space leaves the profile open in a DM", () => {
        expect(show(false)).toBe("members");
        choose("closed");
        expect(show(true)).toBe("members");
        expect(show(false)).toBe("closed");
    });

    it("sets the mode of whichever kind of room is open", () => {
        show(false);
        choose("pins");
        show(true);
        choose("search");
        expect(show(false)).toBe("pins");
        expect(show(true)).toBe("search");
    });

    it("remembers each across a restart", () => {
        show(true);
        choose("closed");
        show(false);
        choose("info");
        act(() => {
            root.unmount();
        });
        root = createRoot(container);
        expect(show(true)).toBe("closed");
        expect(show(false)).toBe("info");
    });

    it("starts DMs from the shared setting the first time", () => {
        window.localStorage.setItem("heorot.ui.rightSidebarMode", "closed");
        expect(show(true)).toBe("closed");
        expect(window.localStorage.getItem("heorot.ui.rightSidebarMode.direct")).toBe("closed");
    });

    it("falls back to members for an unknown stored value", () => {
        window.localStorage.setItem("heorot.ui.rightSidebarMode", "sideways");
        expect(show(false)).toBe("members");
        expect(show(true)).toBe("members");
    });
});

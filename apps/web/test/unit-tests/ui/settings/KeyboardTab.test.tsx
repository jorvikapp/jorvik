import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeyboardTab } from "../../../../src/ui/settings/user/tabs/KeyboardTab";

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

describe("KeyboardTab", () => {
    it("lists the shortcuts with this keyboard's keys", () => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
        act(() => {
            root.render(<KeyboardTab />);
        });
        const rows = [...container.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("kbd")].map((key) => key.textContent));
        expect(rows).toEqual([["Ctrl+K"], ["Enter"], ["Shift+Enter"], ["↑"], ["Esc"], ["Tab", "Enter"], ["Ctrl+Shift+I"]]);
    });
});

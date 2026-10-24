import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusMenu } from "../../../../src/ui/components/presence/StatusMenu";

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

function descriptions(autoIdleOn: boolean): Record<string, string> {
    act(() => {
        root.render(
            <StatusMenu
                choice="online"
                statusMessage=""
                error={null}
                autoIdleOn={autoIdleOn}
                onChoose={() => undefined}
                onStatusMessage={() => undefined}
                onClose={() => undefined}
            />,
        );
    });
    return Object.fromEntries(
        Array.from(container.querySelectorAll(".status-menu-item")).map((item) => [
            item.querySelector(".status-menu-label")?.textContent ?? "",
            item.querySelector(".status-menu-description")?.textContent ?? "",
        ]),
    );
}

describe("StatusMenu", () => {
    // The menu didn't say that Online goes idle by itself or that a picked Idle stays, so people
    // picked Idle when they left and then chatted as Idle the next day.
    it("says Online goes idle by itself and a picked Idle stays", () => {
        const text = descriptions(true);
        expect(text.Online).toBe("Goes idle when you're away");
        expect(text.Idle).toBe("Shown as away until you change it");
    });

    it("doesn't promise auto-idle when it's set to Never", () => {
        expect(descriptions(false).Online).toBe("Visible and active");
    });

    it("has a quick switch for sharing game activity, and the way to Activity Privacy", () => {
        const onToggle = vi.fn();
        const onOpenSettings = vi.fn();
        const onClose = vi.fn();
        act(() => {
            root.render(
                <StatusMenu
                    choice="online"
                    statusMessage=""
                    error={null}
                    autoIdleOn
                    activitySharing={{ enabled: false, onToggle, onOpenSettings }}
                    onChoose={() => undefined}
                    onStatusMessage={() => undefined}
                    onClose={onClose}
                />,
            );
        });
        const label = [...container.querySelectorAll("label")].find((candidate) =>
            candidate.textContent?.includes("Share game activity"),
        );
        act(() => label!.querySelector("input")!.click());
        expect(onToggle).toHaveBeenCalledWith(true);

        act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Activity Privacy")!.click());
        expect(onClose).toHaveBeenCalled();
        expect(onOpenSettings).toHaveBeenCalled();
    });
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN = "@admin:matrix.jorvik.app";
const RIFF = "@riff:matrix.jorvik.app";

const mocks = vi.hoisted(() => ({
    settings: { roomId: null as string | null, managers: ["@admin:matrix.jorvik.app"] as readonly string[] },
    saveUserBadges: vi.fn(async () => {}),
    createBadgesRoom: vi.fn(async () => "!new:matrix.jorvik.app"),
}));

vi.mock("../../../../src/ui/hooks/useUserBadges", () => ({
    useBadgeSettings: () => mocks.settings,
    useUserBadges: () => [],
}));

vi.mock("../../../../src/core/badges/userBadges", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../src/core/badges/userBadges")>()),
    getUserBadges: (userId: string) => (userId === "@riff:matrix.jorvik.app" ? ["staff"] : []),
    saveUserBadges: mocks.saveUserBadges,
    createBadgesRoom: mocks.createBadgesRoom,
}));

import { BadgesDialog } from "../../../../src/ui/components/badges/BadgesDialog";

let container: HTMLDivElement;
let root: Root;
const client = { getUserId: () => ADMIN } as never;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.saveUserBadges.mockReset().mockResolvedValue(undefined);
    mocks.createBadgesRoom.mockClear();
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

function render(onClose = vi.fn()) {
    act(() => {
        root.render(<BadgesDialog client={client} userId={RIFF} displayName="Riff" open onClose={onClose} />);
    });
    return onClose;
}

function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`No ${label} button`);
    return found;
}

function checkbox(label: string): HTMLInputElement {
    const option = [...container.querySelectorAll("label")].find((l) => l.textContent?.includes(label));
    return option!.querySelector("input")!;
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
    });
}

describe("BadgesDialog", () => {
    it("offers to set badges up, then shows what the server needs", async () => {
        mocks.settings = { roomId: null, managers: [ADMIN] };
        render();
        expect(container.textContent).toContain("Badges aren't set up on this server yet.");

        await click(button("Set up badges"));
        expect(mocks.createBadgesRoom).toHaveBeenCalledWith(client, [ADMIN]);
        expect(container.querySelector(".badges-dialog-snippet")?.textContent).toBe(
            '"app.jorvik.badges": {"room_id":"!new:matrix.jorvik.app","managers":["@admin:matrix.jorvik.app"]}',
        );
    });

    it("ticks the person's badges and saves the new set", async () => {
        mocks.settings = { roomId: "!badges:matrix.jorvik.app", managers: [ADMIN] };
        const onClose = render();
        expect(container.querySelector(".room-dialog-title")?.textContent).toBe("Badges for Riff");
        expect(checkbox("Staff").checked).toBe(true);
        expect(checkbox("Tester").checked).toBe(false);
        expect(button("Save").disabled).toBe(true);

        await click(checkbox("Tester"));
        expect(button("Save").disabled).toBe(false);
        await click(button("Save"));
        expect(mocks.saveUserBadges).toHaveBeenCalledWith(client, RIFF, ["staff", "tester"]);
        expect(onClose).toHaveBeenCalled();
    });

    it("stays open and says why when saving fails", async () => {
        mocks.settings = { roomId: "!badges:matrix.jorvik.app", managers: [ADMIN] };
        mocks.saveUserBadges.mockRejectedValue(new Error("You don't have permission"));
        const onClose = render();

        await click(checkbox("Staff"));
        await click(button("Save"));
        expect(container.querySelector(".room-dialog-error")?.textContent).toBe(
            "Couldn't save the badges: You don't have permission",
        );
        expect(onClose).not.toHaveBeenCalled();
    });
});

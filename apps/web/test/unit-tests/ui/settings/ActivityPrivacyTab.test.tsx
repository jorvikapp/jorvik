import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_PRIVACY_EVENT } from "../../../../src/core/activity/activityPrivacy";
import type { ActivityGame } from "../../../../src/core/activity/activityWire";
import { ActivityPrivacyTab } from "../../../../src/ui/settings/user/tabs/ActivityPrivacyTab";

let container: HTMLDivElement;
let root: Root;

function space(roomId: string, name: string, joinedCount: number) {
    return {
        roomId,
        name,
        isSpaceRoom: () => true,
        getMyMembership: () => "join",
        getJoinedMemberCount: () => joinedCount,
        getMxcAvatarUrl: () => null,
    };
}

function fakeClient(stored?: Record<string, unknown>) {
    const emitter = new EventEmitter();
    let content = stored;
    const setAccountData = vi.fn(async (_type: string, next: Record<string, unknown>) => {
        content = next;
    });
    return Object.assign(emitter, {
        getRooms: () => [space("!club:s", "Book Club", 12), space("!hall:s", "Great Hall", 900)],
        getAccountData: (type: string) => (type === ACTIVITY_PRIVACY_EVENT && content ? { getContent: () => content } : undefined),
        setAccountData,
        mxcUrlToHttp: () => null,
        removeListener: emitter.removeListener.bind(emitter),
    });
}

async function render(client: ReturnType<typeof fakeClient>, detectedGame: ActivityGame | null = null): Promise<void> {
    await act(async () => {
        root.render(
            <ActivityPrivacyTab
                client={client as never}
                detectedGame={detectedGame}
                onOpenProfile={() => undefined}
                onToast={() => undefined}
            />,
        );
    });
}

function labelled(text: string): HTMLInputElement {
    const label = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes(text));
    if (!label) {
        throw new Error(`nothing labelled ${text}`);
    }
    return label.querySelector("input")!;
}

function spaceSwitch(name: string): HTMLInputElement {
    return container.querySelector<HTMLInputElement>(`input[aria-label="Share with ${name}"]`)!;
}

function button(text: string): HTMLButtonElement {
    return [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text)!;
}

function lastSaved(client: ReturnType<typeof fakeClient>): Record<string, unknown> {
    const calls = client.setAccountData.mock.calls;
    expect(calls[calls.length - 1][0]).toBe(ACTIVITY_PRIVACY_EVENT);
    return calls[calls.length - 1][1];
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.heorotDesktop;
});

describe("ActivityPrivacyTab", () => {
    it("is off until turned on, and saves that to the account", async () => {
        const client = fakeClient();
        await render(client);
        expect(labelled("Share my activity").checked).toBe(false);
        expect(container.textContent).toContain("Your activity isn't shared.");

        await act(async () => labelled("Share my activity").click());
        expect(lastSaved(client)).toMatchObject({ enabled: true, space_scope: "small", share_with_friends: true });
    });

    it("says where games are recognized", async () => {
        await render(fakeClient());
        expect(container.textContent).toContain("Available in the desktop app");
    });

    it("lists the spaces with small ones on by default, and says who can see it", async () => {
        await render(fakeClient({ enabled: true }));
        expect(spaceSwitch("Book Club").checked).toBe(true);
        expect(spaceSwitch("Great Hall").checked).toBe(false);
        expect(container.textContent).toContain("900 members");
        expect(container.textContent).toContain("Activity visible to: friends and 1 space.");
    });

    it("saves a space's own switch only where it differs from the default", async () => {
        const client = fakeClient({ enabled: true });
        await render(client);
        await act(async () => spaceSwitch("Great Hall").click());
        expect(lastSaved(client).space_overrides).toEqual({ "!hall:s": true });

        await act(async () => spaceSwitch("Great Hall").click());
        expect(lastSaved(client).space_overrides).toEqual({});
    });

    it("turns every space off at once", async () => {
        const client = fakeClient({ enabled: true, space_scope: "all" });
        await render(client);
        await act(async () => button("Toggle all off").click());
        expect(lastSaved(client).space_overrides).toEqual({ "!club:s": false, "!hall:s": false });
        expect(spaceSwitch("Book Club").checked).toBe(false);
    });

    it("picks the default for spaces", async () => {
        const client = fakeClient({ enabled: true });
        await render(client);
        await act(async () => labelled("No spaces").click());
        expect(lastSaved(client).space_scope).toBe("none");
        expect(spaceSwitch("Book Club").checked).toBe(false);
    });

    it("finds spaces by name", async () => {
        await render(fakeClient({ enabled: true }));
        const search = container.querySelector<HTMLInputElement>('input[aria-label="Search spaces"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "book");
            search.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(spaceSwitch("Book Club")).not.toBeNull();
        expect(spaceSwitch("Great Hall")).toBeNull();
    });

    it("hides the game that's running, and shows it again", async () => {
        const client = fakeClient({ enabled: true });
        await render(client, { id: "wow", name: "World of Warcraft" });
        await act(async () => button("Hide World of Warcraft").click());
        expect(lastSaved(client)).toMatchObject({ hidden_games: ["wow"], hidden_game_names: { wow: "World of Warcraft" } });
        expect(container.textContent).not.toContain("Hide World of Warcraft");

        await act(async () => button("Show again").click());
        expect(lastSaved(client)).toMatchObject({ hidden_games: [], hidden_game_names: {} });
    });
});

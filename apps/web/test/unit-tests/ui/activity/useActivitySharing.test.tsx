import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultActivityPrivacy, type ActivityPrivacySettings } from "../../../../src/core/activity/activityPrivacy";
import { clearActivity, getUserActivity } from "../../../../src/core/activity/activityStore";
import type { ActivityGame } from "../../../../src/core/activity/activityWire";
import { useActivitySharing } from "../../../../src/ui/activity/useActivity";

const ME = "@me:s";
const WOW: ActivityGame = { id: "wow", name: "World of Warcraft" };

let container: HTMLDivElement;
let root: Root;

function fakeClient() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        getUserId: () => ME,
        getSafeUserId: () => ME,
        getDeviceId: () => "DEV",
        getRooms: () => [],
        getIgnoredUsers: () => [],
        getAccountData: () => undefined,
        getCrypto: () => undefined,
        removeListener: emitter.removeListener.bind(emitter),
    });
}

const client = fakeClient();

function Probe(props: { settings: ActivityPrivacySettings; game: ActivityGame | null; invisible: boolean }): null {
    useActivitySharing(client as never, props.settings, props.game, props.invisible);
    return null;
}

async function render(settings: ActivityPrivacySettings, game: ActivityGame | null, invisible = false): Promise<void> {
    await act(async () => {
        root.render(<Probe settings={settings} game={game} invisible={invisible} />);
    });
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
    clearActivity();
});

describe("useActivitySharing", () => {
    const on = { ...defaultActivityPrivacy(), enabled: true };

    it("shares the running game while sharing is on", async () => {
        await render(on, WOW);
        expect(getUserActivity(ME)?.game).toEqual(WOW);

        await render(on, null);
        expect(getUserActivity(ME)).toBeNull();
    });

    it("shares nothing while it's off, while the user is invisible, or for a hidden game", async () => {
        await render(defaultActivityPrivacy(), WOW);
        expect(getUserActivity(ME)).toBeNull();

        // Sharing a game would give away that an invisible user is online.
        await render(on, WOW, true);
        expect(getUserActivity(ME)).toBeNull();

        await render({ ...on, hidden_games: ["wow"] }, WOW);
        expect(getUserActivity(ME)).toBeNull();
    });

    it("keeps the start time while the same game runs", async () => {
        await render(on, WOW);
        const startedAt = getUserActivity(ME)?.startedAt;
        await render({ ...on, share_with_friends: false }, WOW);
        expect(getUserActivity(ME)?.startedAt).toBe(startedAt);
    });
});

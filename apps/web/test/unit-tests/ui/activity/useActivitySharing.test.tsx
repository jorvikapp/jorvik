import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberedGameIcon, uploadGameIcon } from "../../../../src/core/activity/activityIcons";
import { defaultActivityPrivacy, type ActivityPrivacySettings } from "../../../../src/core/activity/activityPrivacy";
import { clearActivity, getUserActivity } from "../../../../src/core/activity/activityStore";
import type { ActivityGame, ActivityIconFile } from "../../../../src/core/activity/activityWire";
import { useActivitySharing } from "../../../../src/ui/activity/useActivity";

vi.mock("../../../../src/core/activity/activityIcons", () => ({
    clearGameIconUrls: vi.fn(),
    loadGameIconUrl: vi.fn(),
    peekGameIconUrl: vi.fn(),
    rememberedGameIcon: vi.fn(),
    uploadGameIcon: vi.fn(),
}));

const ME = "@me:s";
const WOW: ActivityGame = { id: "wow", name: "World of Warcraft" };
const STARDEW: ActivityGame = { id: "steam-413150", name: "Stardew Valley" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ICON: ActivityIconFile = {
    url: "mxc://s/stardew",
    key: { kty: "oct", alg: "A256CTR", k: "a".repeat(43), key_ops: ["encrypt", "decrypt"], ext: true },
    iv: "b".repeat(22),
    hashes: { sha256: "c".repeat(43) },
    v: "v2",
};

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
    delete window.heorotDesktop;
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

    it("sends a Steam game's icon once the desktop app has handed it over and it's uploaded", async () => {
        const getGameIcon = vi.fn(async () => PNG);
        window.heorotDesktop = { getGameIcon };
        vi.mocked(rememberedGameIcon).mockReturnValue(null);
        vi.mocked(uploadGameIcon).mockResolvedValue(ICON);

        await render(on, STARDEW);
        expect(getGameIcon).toHaveBeenCalledWith("steam-413150");
        expect(uploadGameIcon).toHaveBeenCalledWith(client, ME, "steam-413150", PNG);
        expect(getUserActivity(ME)?.game).toEqual({ ...STARDEW, icon: ICON });
    });

    it("sends the icon uploaded before at once, and looks for none for a game that isn't shared", async () => {
        const getGameIcon = vi.fn(async () => PNG);
        window.heorotDesktop = { getGameIcon };
        vi.mocked(rememberedGameIcon).mockReturnValue(ICON);
        await render(on, STARDEW);
        expect(getUserActivity(ME)?.game.icon).toEqual(ICON);
        expect(getGameIcon).not.toHaveBeenCalled();

        vi.mocked(rememberedGameIcon).mockReturnValue(null);
        await render({ ...on, hidden_games: ["steam-413150"] }, STARDEW);
        await render(on, STARDEW, true);
        await render(defaultActivityPrivacy(), STARDEW);
        expect(getGameIcon).not.toHaveBeenCalled();
        expect(uploadGameIcon).not.toHaveBeenCalled();
    });

    it("keeps the start time while the same game runs", async () => {
        await render(on, WOW);
        const startedAt = getUserActivity(ME)?.startedAt;
        await render({ ...on, share_with_friends: false }, WOW);
        expect(getUserActivity(ME)?.startedAt).toBe(startedAt);
    });
});

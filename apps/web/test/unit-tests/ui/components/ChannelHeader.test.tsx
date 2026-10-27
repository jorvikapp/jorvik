import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadGameIconUrl } from "../../../../src/core/activity/activityIcons";
import { clearActivity, receiveActivity } from "../../../../src/core/activity/activityStore";
import type { ActivityIconFile } from "../../../../src/core/activity/activityWire";
import { ChannelHeader } from "../../../../src/ui/components/header/ChannelHeader";

vi.mock("../../../../src/core/activity/activityIcons", () => ({
    clearGameIconUrls: vi.fn(),
    loadGameIconUrl: vi.fn(),
    peekGameIconUrl: vi.fn(),
    rememberedGameIcon: vi.fn(),
    uploadGameIcon: vi.fn(),
}));

const ICON: ActivityIconFile = {
    url: "mxc://s/dota",
    key: { kty: "oct", alg: "A256CTR", k: "a".repeat(43), key_ops: ["encrypt", "decrypt"], ext: true },
    iv: "b".repeat(22),
    hashes: { sha256: "c".repeat(43) },
    v: "v2",
};
const client = {} as never;
const dm = {
    roomId: "!dm:s",
    name: "Bob",
    getCanonicalAlias: () => null,
    currentState: { getStateEvents: () => null },
} as never;

let container: HTMLDivElement;
let root: Root;

function renderHeader(): void {
    const noop = (): void => undefined;
    act(() => {
        root.render(
            <ChannelHeader
                room={dm}
                client={client}
                directName="Bob"
                directUserId="@bob:s"
                isDirectMessage
                isOneToOneDirect
                showHashPrefix={false}
                sidebarMode="closed"
                searchQuery=""
                canInviteInRoom={false}
                onSearchQueryChange={noop}
                onSelectSidebarMode={noop}
                onOpenDirectChat={noop}
                onOpenCreateRoom={noop}
                onOpenJoinRoom={noop}
                onOpenInviteUsers={noop}
                onOpenRoomSettings={noop}
                onOpenModeration={noop}
                onCopyRoomLink={async () => undefined}
                onLeaveRoom={async () => undefined}
            />,
        );
    });
}

function topic(): HTMLElement {
    return container.querySelector(".channel-header-topic")!;
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

describe("ChannelHeader in a DM", () => {
    it("shows the game's own icon before what the other person is playing", async () => {
        vi.mocked(loadGameIconUrl).mockResolvedValue("blob:dota");
        renderHeader();
        expect(topic().textContent).toBe("Direct message");

        await act(async () => {
            receiveActivity(
                "@bob:s",
                "PC",
                { game: { id: "steam-570", name: "Dota 2", icon: ICON }, startedAt: Date.now(), expiresAt: Date.now() + 60_000 },
                Date.now(),
            );
        });
        expect(loadGameIconUrl).toHaveBeenCalledWith(client, ICON);
        expect(topic().querySelector("img.activity-game-icon")?.getAttribute("src")).toBe("blob:dota");
        expect(topic().textContent).toBe("Playing Dota 2");
        expect(topic().title).toBe("Playing Dota 2");
    });

    it("shows the controller for a game without an icon, and the usual line once they stop", () => {
        renderHeader();
        act(() => {
            receiveActivity(
                "@bob:s",
                "PC",
                { game: { id: "wow", name: "World of Warcraft" }, startedAt: Date.now(), expiresAt: Date.now() + 60_000 },
                Date.now(),
            );
        });
        expect(topic().querySelector("img")).toBeNull();
        expect(topic().textContent).toBe("🎮Playing World of Warcraft");
        expect(topic().title).toBe("Playing World of Warcraft");

        act(() => {
            receiveActivity("@bob:s", "PC", { game: null }, Date.now());
        });
        expect(topic().textContent).toBe("Direct message");
    });
});

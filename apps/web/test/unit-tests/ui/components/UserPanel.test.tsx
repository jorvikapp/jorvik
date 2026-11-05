import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setOwnActivity } from "../../../../src/core/activity/activityStore";
import { UserPanel, userPanelContext, type UserPanelProps } from "../../../../src/ui/components/user/UserPanel";
import { getLocalAvState, setDeafened, setMicMuted } from "../../../../src/ui/voice/localAvState";

const ME = "@me:example.org";
const STARDEW = { id: "steam:413150", name: "Stardew Valley" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setDeafened(false);
    setMicMuted(false);
    setOwnActivity(ME, null);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    setOwnActivity(ME, null);
    setDeafened(false);
    setMicMuted(false);
    window.localStorage.clear();
    vi.restoreAllMocks();
});

function renderPanel(props: Partial<UserPanelProps> = {}): void {
    act(() => {
        root.render(
            <UserPanel
                userId={ME}
                displayName="Me"
                avatarSources={[]}
                handle="@me"
                presence={null}
                onOpenSettings={() => undefined}
                {...props}
            />,
        );
    });
}

const button = (label: string): HTMLButtonElement => {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) {
        throw new Error(`no ${label} button`);
    }
    return found;
};
const click = (element: HTMLElement): void => {
    act(() => {
        element.click();
    });
};
const contextLine = (): HTMLElement => container.querySelector<HTMLElement>(".pane-user-context")!;

describe("the line under your name", () => {
    it("shows the game you share in place of your handle, and your handle again once the game closes", () => {
        setOwnActivity(ME, { game: STARDEW, startedAt: Date.now() });
        renderPanel();
        expect(contextLine().textContent).toContain("Playing Stardew Valley");
        expect(contextLine().className).toContain("is-game");
        expect(contextLine().getAttribute("title")).toBe("Playing Stardew Valley");

        act(() => setOwnActivity(ME, null));
        expect(contextLine().textContent).toBe("@me");
        expect(contextLine().className).toContain("is-handle");
    });

    it("shows your status message when you're not sharing a game, and the game over it when you are", () => {
        renderPanel({ statusMessage: "Brewing coffee" });
        expect(contextLine().textContent).toBe("Brewing coffee");

        act(() => setOwnActivity(ME, { game: STARDEW, startedAt: Date.now() }));
        expect(contextLine().textContent).toContain("Playing Stardew Valley");
    });

    it("keeps a long name and line whole in their tooltips (the panel cuts them short with ...)", () => {
        const long = "A very long display name that goes on and on past the edge of the panel";
        renderPanel({ displayName: long, statusMessage: `${long}, and a status to match` });
        expect(container.querySelector(".pane-user-name")?.getAttribute("title")).toBe(long);
        expect(contextLine().getAttribute("title")).toBe(`${long}, and a status to match`);
    });

    it("picks the game, then the status message, then the handle", () => {
        const playing = { game: STARDEW, startedAt: 0, expiresAt: 0, receivedAt: 0 };
        expect(userPanelContext(playing, "Busy", "@me")).toMatchObject({ kind: "game", text: "Playing Stardew Valley" });
        expect(userPanelContext(null, "Busy", "@me")).toEqual({ kind: "status", text: "Busy" });
        expect(userPanelContext(null, "   ", "@me")).toEqual({ kind: "handle", text: "@me" });
        expect(userPanelContext(null, null, "@me")).toEqual({ kind: "handle", text: "@me" });
    });
});

describe("mic, deafen and settings", () => {
    it("mutes and unmutes your mic with no call going, red while muted", () => {
        renderPanel();
        const mic = button("Mute");
        expect(mic.getAttribute("aria-pressed")).toBe("false");

        click(mic);
        expect(getLocalAvState().micMuted).toBe(true);
        expect(mic.getAttribute("aria-pressed")).toBe("true");
        expect(mic.className).toContain("is-muted");
        expect(mic.getAttribute("title")).toBe("Unmute");

        click(mic);
        expect(getLocalAvState().micMuted).toBe(false);
        expect(mic.className).not.toContain("is-muted");
    });

    it("deafen mutes the mic too, and undeafen turns it back on", () => {
        renderPanel();
        click(button("Deafen"));
        expect(button("Deafen").getAttribute("aria-pressed")).toBe("true");
        expect(button("Mute").getAttribute("aria-pressed")).toBe("true");

        click(button("Deafen"));
        expect(button("Deafen").getAttribute("aria-pressed")).toBe("false");
        expect(button("Mute").getAttribute("aria-pressed")).toBe("false");
    });

    it("leaves a mic that was muted before deafening muted after", () => {
        renderPanel();
        click(button("Mute"));
        click(button("Deafen"));
        click(button("Deafen"));
        expect(button("Mute").getAttribute("aria-pressed")).toBe("true");
        expect(getLocalAvState()).toMatchObject({ micMuted: true, deafened: false });
    });

    it("opens settings from the gear, and the status menu from your name when there's presence", () => {
        const onOpenSettings = vi.fn();
        const onToggleMenu = vi.fn();
        renderPanel({ onOpenSettings, presence: { choice: "online", title: "Set your status", menuOpen: false, onToggleMenu } });
        click(button("User settings"));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
        click(container.querySelector<HTMLButtonElement>(".pane-user-card")!);
        expect(onToggleMenu).toHaveBeenCalledTimes(1);
        expect(container.querySelector(".avatar-presence-dot.is-online")).not.toBeNull();
    });

    it("opens settings from your name too when the server has no presence", () => {
        const onOpenSettings = vi.fn();
        renderPanel({ onOpenSettings });
        click(container.querySelector<HTMLButtonElement>(".pane-user-card")!);
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
        expect(container.querySelector(".avatar-presence-dot")).toBeNull();
    });

    it("shows invisible as offline on your avatar", () => {
        renderPanel({ presence: { choice: "invisible", title: "Set your status", menuOpen: false, onToggleMenu: () => undefined } });
        expect(container.querySelector(".avatar-presence-dot.is-offline")).not.toBeNull();
    });
});

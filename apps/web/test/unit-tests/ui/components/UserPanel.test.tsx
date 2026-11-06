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
const shownText = (): string | null | undefined => contextLine().querySelector(".pane-user-context-text")?.textContent;

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

    it("shows the game's name alone, its icon saying it's a game; \"Playing\" is for screen readers and the tooltip", () => {
        setOwnActivity(ME, { game: STARDEW, startedAt: Date.now() });
        renderPanel();
        expect(shownText()).toBe("Stardew Valley");
        expect(contextLine().querySelector(".pane-user-context-icon")?.getAttribute("aria-hidden")).toBe("true");
        expect(contextLine().querySelector(".pane-user-context-verb")?.textContent).toBe("Playing ");
        expect(contextLine().getAttribute("title")).toBe("Playing Stardew Valley");
        // What a screen reader reads out for the card, the icon left out.
        const spoken = [...contextLine().children]
            .filter((child) => child.getAttribute("aria-hidden") !== "true")
            .map((child) => child.textContent)
            .join("");
        expect(spoken).toBe("Playing Stardew Valley");
    });

    it("shows your status message when you're not sharing a game, and the game over it when you are", () => {
        renderPanel({ statusMessage: "Brewing coffee" });
        expect(contextLine().textContent).toBe("Brewing coffee");
        expect(shownText()).toBe("Brewing coffee");

        act(() => setOwnActivity(ME, { game: STARDEW, startedAt: Date.now() }));
        expect(shownText()).toBe("Stardew Valley");
        expect(contextLine().getAttribute("title")).toBe("Playing Stardew Valley");
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

describe("device pickers next to mic and deafen", () => {
    const device = (kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo =>
        ({ kind, deviceId, label, groupId: "g", toJSON: () => ({}) }) as MediaDeviceInfo;
    const MICS = [device("audioinput", "default", "Default - Built-in Microphone"), device("audioinput", "usb", "USB Microphone")];
    const SPEAKERS = [device("audiooutput", "default", "Default - Speakers"), device("audiooutput", "hp", "Headphones")];
    let onChoose: ReturnType<typeof vi.fn>;
    let onOpenAudioSettings: ReturnType<typeof vi.fn>;

    function media(list: () => Promise<MediaDeviceInfo[]>, permission?: PermissionState, getUserMedia = vi.fn()): void {
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { enumerateDevices: list, getUserMedia, addEventListener: vi.fn(), removeEventListener: vi.fn() },
        });
        Object.defineProperty(navigator, "permissions", {
            configurable: true,
            value: permission ? { query: async () => ({ state: permission }) } : undefined,
        });
    }

    beforeEach(() => {
        media(async () => [...MICS, ...SPEAKERS]);
        Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", { configurable: true, value: async () => undefined });
        onChoose = vi.fn();
        onOpenAudioSettings = vi.fn();
    });

    afterEach(() => {
        delete (navigator as { mediaDevices?: unknown }).mediaDevices;
        delete (navigator as { permissions?: unknown }).permissions;
        delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    });

    const devices = (over: Partial<NonNullable<UserPanelProps["devices"]>> = {}): UserPanelProps["devices"] => ({
        inputId: "default",
        outputId: "default",
        onChoose,
        onOpenSettings: onOpenAudioSettings,
        ...over,
    });
    async function settle(): Promise<void> {
        await act(async () => {
            for (let tick = 0; tick < 6; tick += 1) {
                await Promise.resolve();
            }
        });
    }
    const listed = (): Array<{ label: string; checked: string | null }> =>
        [...container.querySelectorAll('.device-menu [role="menuitemradio"]')].map((item) => ({
            label: item.querySelector(".device-menu-label")?.textContent ?? "",
            checked: item.getAttribute("aria-checked"),
        }));
    const item = (label: string): HTMLButtonElement => {
        const found = [...container.querySelectorAll<HTMLButtonElement>('.device-menu [role^="menuitem"]')].find(
            (entry) => entry.querySelector(".device-menu-label")?.textContent === label,
        );
        if (!found) {
            throw new Error(`no ${label} in the menu`);
        }
        return found;
    };
    const note = (): string => container.querySelector(".device-menu-note")?.textContent ?? "";

    it("lists the microphones with the one in use ticked; choosing one changes the device and nothing else", async () => {
        renderPanel({ devices: devices({ inputId: "usb" }) });
        click(button("Choose microphone"));
        await settle();
        expect(button("Choose microphone").getAttribute("aria-expanded")).toBe("true");
        expect(listed()).toEqual([
            { label: "Default - Built-in Microphone", checked: "false" },
            { label: "USB Microphone", checked: "true" },
        ]);

        click(item("Default - Built-in Microphone"));
        expect(onChoose).toHaveBeenCalledWith("audioinput", "default");
        expect(container.querySelector(".device-menu")).toBeNull();
        expect(getLocalAvState()).toMatchObject({ micMuted: false, deafened: false });
    });

    it("keeps you muted and deafened while you change microphone and speaker", async () => {
        renderPanel({ devices: devices() });
        click(button("Mute"));
        click(button("Deafen"));
        click(button("Choose microphone"));
        await settle();
        click(item("USB Microphone"));
        click(button("Choose speaker"));
        await settle();
        expect(listed().map((entry) => entry.label)).toEqual(["Default - Speakers", "Headphones"]);
        click(item("Headphones"));
        expect(onChoose.mock.calls).toEqual([
            ["audioinput", "usb"],
            ["audiooutput", "hp"],
        ]);
        expect(getLocalAvState()).toMatchObject({ micMuted: true, deafened: true });
        expect(button("Mute").getAttribute("aria-pressed")).toBe("true");
    });

    it("leaves muting to the mic button itself: the chevron only opens and closes its menu", async () => {
        renderPanel({ devices: devices() });
        click(button("Choose microphone"));
        await settle();
        click(button("Choose microphone"));
        expect(container.querySelector(".device-menu")).toBeNull();
        expect(getLocalAvState().micMuted).toBe(false);
        click(button("Mute"));
        expect(getLocalAvState().micMuted).toBe(true);
    });

    it("says why there's nothing to choose, without failing", async () => {
        renderPanel({ devices: devices() });

        media(async () => [], "granted");
        click(button("Choose microphone"));
        await settle();
        expect(note()).toBe("No microphones found.");
        click(button("Choose microphone"));

        media(async () => [device("audioinput", "", "")], "denied");
        click(button("Choose microphone"));
        await settle();
        expect(note()).toContain("Microphone access is blocked");
        click(button("Choose microphone"));

        delete (navigator as { mediaDevices?: unknown }).mediaDevices;
        click(button("Choose microphone"));
        await settle();
        expect(note()).toBe("This browser can't list your microphones.");
        click(button("Choose microphone"));

        delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
        click(button("Choose speaker"));
        await settle();
        expect(note()).toContain("This browser can't choose where sound plays");
        expect(listed()).toEqual([]);
    });

    it("asks for the microphone when the names are hidden, then lists them", async () => {
        let allowed = false;
        const stop = vi.fn();
        const getUserMedia = vi.fn(async () => {
            allowed = true;
            return { getTracks: () => [{ stop }] };
        });
        media(async () => (allowed ? MICS : [device("audioinput", "", "")]), "prompt", getUserMedia);
        renderPanel({ devices: devices() });
        click(button("Choose microphone"));
        await settle();
        expect(note()).toContain("Allow the microphone");
        click(item("Allow the microphone"));
        await settle();
        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(stop).toHaveBeenCalled();
        expect(listed().map((entry) => entry.label)).toEqual(["Default - Built-in Microphone", "USB Microphone"]);
        expect(getLocalAvState().micMuted).toBe(false);
    });

    it("works from the keyboard: focus starts on the device in use, arrows move, Escape goes back", async () => {
        renderPanel({ devices: devices({ inputId: "usb" }) });
        click(button("Choose microphone"));
        await settle();
        expect(document.activeElement).toBe(item("USB Microphone"));
        const key = (name: string): void => {
            act(() => {
                document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
            });
        };
        key("ArrowDown");
        expect(document.activeElement).toBe(item("Voice and video settings"));
        key("ArrowUp");
        key("ArrowUp");
        expect(document.activeElement).toBe(item("Default - Built-in Microphone"));
        key("Escape");
        expect(container.querySelector(".device-menu")).toBeNull();
        expect(document.activeElement).toBe(button("Choose microphone"));
    });

    it("opens Voice and video settings from the menu", async () => {
        renderPanel({ devices: devices() });
        click(button("Choose speaker"));
        await settle();
        click(item("Voice and video settings"));
        expect(onOpenAudioSettings).toHaveBeenCalledTimes(1);
        expect(container.querySelector(".device-menu")).toBeNull();
    });

    it("has no chevrons when the app gives no way to choose devices", () => {
        renderPanel();
        expect(container.querySelector('button[aria-label="Choose microphone"]')).toBeNull();
        expect(container.querySelector(".user-panel-split.has-chevron")).toBeNull();
    });
});

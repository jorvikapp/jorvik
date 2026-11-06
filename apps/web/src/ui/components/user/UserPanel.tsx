import React, { useCallback, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { UserActivity } from "../../../core/activity/activityStore";
import type { ActivityGame } from "../../../core/activity/activityWire";
import type { PresenceChoice } from "../../../core/presence/presenceControl";
import { useUserActivity } from "../../activity/useActivity";
import type { AudioDeviceKind } from "../../voice/audioDevices";
import { toggleDeafened, toggleMicMuted, useLocalAvState } from "../../voice/localAvState";
import { GameIcon } from "../activity/ActivityLine";
import { Avatar } from "../Avatar";
import { GearIcon, MicIcon, SoundIcon } from "../voice/AvIcons";
import { DeviceMenu } from "./DeviceMenu";

/** The panel's second line: the game you share, else your status message, else your handle. */
export type UserPanelContext =
    | { kind: "game"; game: ActivityGame; text: string }
    | { kind: "status"; text: string }
    | { kind: "handle"; text: string };

/**
 * The game shows only while you share it (Activity Privacy on, the desktop app sees it, not hidden, you're
 * not invisible), so the line says what others see. A browser can't see games: it shows your status
 * message, which you set yourself, or your handle.
 */
export function userPanelContext(
    activity: UserActivity | null,
    statusMessage: string | null | undefined,
    handle: string,
): UserPanelContext {
    if (activity) {
        return { kind: "game", game: activity.game, text: `Playing ${activity.game.name}` };
    }
    const status = statusMessage?.trim();
    if (status) {
        return { kind: "status", text: status };
    }
    return { kind: "handle", text: handle };
}

export interface UserPanelPresence {
    choice: PresenceChoice;
    /** For the button: what clicking it does, and how the status is set now. */
    title: string;
    menuOpen: boolean;
    onToggleMenu: () => void;
}

/** The microphone and speaker in use, and how to change them: the voice settings, kept on this device. */
export interface UserPanelDevices {
    inputId: string;
    outputId: string;
    onChoose: (kind: AudioDeviceKind, deviceId: string) => void;
    onOpenSettings: () => void;
}

export interface UserPanelProps {
    /** For the game's own icon; without it the line shows the controller. */
    client?: MatrixClient | null;
    userId: string;
    displayName: string;
    avatarSources: string[];
    /** Shown when there's nothing else to say. */
    handle: string;
    statusMessage?: string | null;
    /** The dot on the avatar and the status menu; null when the server doesn't share presence. */
    presence: UserPanelPresence | null;
    onOpenSettings: () => void;
    /** The device pickers next to mic and deafen; left out, there are none. */
    devices?: UserPanelDevices;
    /** The status menu, shown above the panel while it's open. */
    children?: React.ReactNode;
}

/**
 * You, under the channel list: who you are and what you're doing on the left, and your mic, sound and
 * settings on the right. The mic and sound buttons work outside calls too, and carry into the next one.
 */
export function UserPanel({
    client,
    userId,
    displayName,
    avatarSources,
    handle,
    statusMessage,
    presence,
    onOpenSettings,
    devices,
    children,
}: UserPanelProps): React.ReactElement {
    const av = useLocalAvState();
    const [deviceMenu, setDeviceMenu] = useState<AudioDeviceKind | null>(null);
    const inputChevronRef = useRef<HTMLButtonElement | null>(null);
    const outputChevronRef = useRef<HTMLButtonElement | null>(null);
    const closeDeviceMenu = useCallback(
        (returnFocus: boolean): void => {
            const closing = deviceMenu;
            setDeviceMenu(null);
            if (returnFocus) {
                (closing === "audiooutput" ? outputChevronRef : inputChevronRef).current?.focus();
            }
        },
        [deviceMenu],
    );
    // A small button beside mic or deafen: opens the devices to choose from, and never mutes or deafens.
    const chevron = (kind: AudioDeviceKind): React.ReactElement | null => {
        if (!devices) {
            return null;
        }
        const open = deviceMenu === kind;
        const label = kind === "audioinput" ? "Choose microphone" : "Choose speaker";
        return (
            <button
                type="button"
                ref={kind === "audioinput" ? inputChevronRef : outputChevronRef}
                className={`user-panel-chevron${open ? " is-open" : ""}`}
                onClick={() => setDeviceMenu((current) => (current === kind ? null : kind))}
                // Like the status menu: a press on its own button leaves closing to the click.
                onMouseDown={(event) => {
                    if (open) {
                        event.nativeEvent.stopPropagation();
                    }
                }}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                title={label}
            >
                <svg className="user-panel-chevron-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
        );
    };
    const activity = useUserActivity(userId);
    const context = userPanelContext(activity, statusMessage, handle);

    return (
        <div className="pane-user-row user-panel">
            <button
                type="button"
                className="pane-user-card"
                onClick={presence ? presence.onToggleMenu : onOpenSettings}
                // The open menu closes on any press outside it, and the click would open it again: this
                // press is the menu's own button, so leave closing to the click.
                onMouseDown={(event) => {
                    if (presence?.menuOpen) {
                        event.nativeEvent.stopPropagation();
                    }
                }}
                title={presence ? presence.title : "Open user settings"}
                aria-haspopup={presence ? "menu" : undefined}
                aria-expanded={presence ? presence.menuOpen : undefined}
            >
                <Avatar
                    className="pane-user-avatar"
                    name={displayName}
                    src={avatarSources[0] ?? null}
                    sources={avatarSources}
                    seed={userId || undefined}
                    userId={userId || undefined}
                    presenceState={presence ? (presence.choice === "invisible" ? "offline" : presence.choice) : null}
                />
                <span className="pane-user-meta">
                    <span className="pane-user-name" title={displayName}>
                        {displayName}
                    </span>
                    <span className={`pane-user-context is-${context.kind}`} title={context.text}>
                        {context.kind === "game" ? (
                            <span className="pane-user-context-icon" aria-hidden="true">
                                <GameIcon client={client} game={context.game} />
                            </span>
                        ) : null}
                        <span className="pane-user-context-text">{context.text}</span>
                    </span>
                </span>
            </button>
            <div className="user-panel-controls" role="group" aria-label="Your mic and sound">
                <span className={`user-panel-split${devices ? " has-chevron" : ""}`}>
                    <button
                        type="button"
                        className={`user-panel-control${av.micMuted ? " is-muted" : ""}`}
                        onClick={toggleMicMuted}
                        aria-label="Mute"
                        aria-pressed={av.micMuted}
                        title={av.micMuted ? "Unmute" : "Mute"}
                    >
                        <MicIcon muted={av.micMuted} className="user-panel-control-icon" />
                    </button>
                    {chevron("audioinput")}
                </span>
                <span className={`user-panel-split${devices ? " has-chevron" : ""}`}>
                    <button
                        type="button"
                        className={`user-panel-control${av.deafened ? " is-muted" : ""}`}
                        onClick={toggleDeafened}
                        aria-label="Deafen"
                        aria-pressed={av.deafened}
                        title={av.deafened ? "Undeafen" : "Deafen"}
                    >
                        <SoundIcon deafened={av.deafened} className="user-panel-control-icon" />
                    </button>
                    {chevron("audiooutput")}
                </span>
                <button
                    type="button"
                    className="user-panel-control"
                    onClick={onOpenSettings}
                    aria-label="User settings"
                    title="User settings"
                >
                    <GearIcon className="user-panel-control-icon" />
                </button>
            </div>
            {devices && deviceMenu ? (
                <DeviceMenu
                    kind={deviceMenu}
                    selectedId={deviceMenu === "audioinput" ? devices.inputId : devices.outputId}
                    onSelect={(deviceId) => devices.onChoose(deviceMenu, deviceId)}
                    onOpenSettings={devices.onOpenSettings}
                    onClose={closeDeviceMenu}
                />
            ) : null}
            {children}
        </div>
    );
}

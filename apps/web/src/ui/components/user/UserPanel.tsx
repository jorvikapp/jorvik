import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { UserActivity } from "../../../core/activity/activityStore";
import type { ActivityGame } from "../../../core/activity/activityWire";
import type { PresenceChoice } from "../../../core/presence/presenceControl";
import { useUserActivity } from "../../activity/useActivity";
import { toggleDeafened, toggleMicMuted, useLocalAvState } from "../../voice/localAvState";
import { GameIcon } from "../activity/ActivityLine";
import { Avatar } from "../Avatar";
import { GearIcon, MicIcon, SoundIcon } from "../voice/AvIcons";

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
    children,
}: UserPanelProps): React.ReactElement {
    const av = useLocalAvState();
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
            {children}
        </div>
    );
}

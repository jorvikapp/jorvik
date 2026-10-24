import React, { useEffect, useMemo, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    activityAudience,
    describeActivityAudience,
    isSpaceIncluded,
    type ActivityPrivacySettings,
    type SpaceScope,
} from "../../../../core/activity/activityPrivacy";
import type { ActivityGame } from "../../../../core/activity/activityWire";
import { roomAvatarSources } from "../../../../core/media/avatar";
import { useJoinedSpaces, type JoinedSpace } from "../../../activity/useActivity";
import { useActivityPrivacy } from "../../../activity/useActivityPrivacy";
import { Avatar } from "../../../components/Avatar";
import type { ToastState } from "../../../components/Toast";

interface ActivityPrivacyTabProps {
    client: MatrixClient;
    /** The game the desktop app sees running now, if any. */
    detectedGame: ActivityGame | null;
    onOpenProfile: () => void;
    onToast: (toast: Omit<ToastState, "id">) => void;
}

type DetectionSupport = "desktop" | "sandboxed" | "browser";

const DETECTION_NOTES: Record<DetectionSupport, string> = {
    desktop:
        "Steam games are recognized, and popular games from other launchers. Only the game's name goes out, " +
        "end-to-end encrypted, to the people you pick below.",
    sandboxed:
        "The Flatpak and Snap versions can't see other programs, so they can't tell which game you're playing. " +
        "What you pick here still applies to the desktop app on your other computers.",
    browser:
        "Available in the desktop app: only it can see which game you're playing. What you pick here applies " +
        "there too.",
};

function useDetectionSupport(): DetectionSupport {
    const [support, setSupport] = useState<DetectionSupport>(() =>
        window.heorotDesktop?.setGameActivityEnabled ? "desktop" : "browser",
    );
    useEffect(() => {
        const check = window.heorotDesktop?.gameActivitySupported;
        if (!check) {
            return;
        }
        void check().then(
            (supported) => setSupport(supported ? "desktop" : "sandboxed"),
            () => undefined,
        );
    }, []);
    return support;
}

/** Sets a space's own toggle; one that matches the default is dropped, so the space follows the default again. */
function withSpace(settings: ActivityPrivacySettings, space: JoinedSpace, included: boolean): ActivityPrivacySettings {
    const overrides = { ...settings.space_overrides };
    delete overrides[space.roomId];
    const byDefault = isSpaceIncluded({ ...settings, space_overrides: {} }, space.roomId, space.joinedCount);
    if (included !== byDefault) {
        overrides[space.roomId] = included;
    }
    return { ...settings, space_overrides: overrides };
}

export function ActivityPrivacyTab({
    client,
    detectedGame,
    onOpenProfile,
    onToast,
}: ActivityPrivacyTabProps): React.ReactElement {
    const { settings, save } = useActivityPrivacy(client);
    const support = useDetectionSupport();
    const spaces = useJoinedSpaces(client);
    const [query, setQuery] = useState("");

    const update = (next: ActivityPrivacySettings): void => {
        void save(next).catch(() =>
            onToast({ type: "error", message: "Couldn't save your activity privacy settings. Try again." }),
        );
    };

    const shownSpaces = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle ? spaces.filter((space) => space.name.toLowerCase().includes(needle)) : spaces;
    }, [query, spaces]);

    const scopes: { scope: SpaceScope; label: string }[] = [
        { scope: "all", label: "All spaces" },
        { scope: "small", label: `Spaces with ${settings.small_space_limit} or fewer members` },
        { scope: "none", label: "No spaces" },
    ];

    const hideGame = (game: ActivityGame): void =>
        update({
            ...settings,
            hidden_games: [...settings.hidden_games, game.id],
            hidden_game_names: { ...settings.hidden_game_names, [game.id]: game.name },
        });
    const unhideGame = (id: string): void => {
        const names = { ...settings.hidden_game_names };
        delete names[id];
        update({ ...settings, hidden_games: settings.hidden_games.filter((hidden) => hidden !== id), hidden_game_names: names });
    };

    return (
        <div className="settings-tab activity-privacy">
            <h2 className="settings-tab-title">Activity Privacy</h2>
            <p className="settings-tab-description">
                Choose who can see the game you're playing. It goes end-to-end encrypted to just those people and
                is never kept in a chat's history. Your status message is separate and stays as you set it.
            </p>

            <div className="settings-section-card">
                <h3>What I share</h3>
                <label className="settings-toggle">
                    <input
                        type="checkbox"
                        checked={settings.enabled}
                        onChange={(event) => update({ ...settings, enabled: event.target.checked })}
                    />
                    Share my activity
                </label>
                <p className="settings-inline-note">{DETECTION_NOTES[support]}</p>

                <h4 className="activity-privacy-heading">Hidden games</h4>
                <p className="settings-inline-note">These are never shared, whatever else you pick.</p>
                {settings.hidden_games.length === 0 ? (
                    <p className="settings-inline-note">No hidden games.</p>
                ) : (
                    <ul className="settings-blocked-list">
                        {settings.hidden_games.map((id) => (
                            <li key={id} className="settings-blocked-item">
                                <span className="settings-blocked-name">{settings.hidden_game_names[id] ?? id}</span>
                                <button type="button" className="settings-button" onClick={() => unhideGame(id)}>
                                    Show again
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {detectedGame && !settings.hidden_games.includes(detectedGame.id) ? (
                    <div className="settings-actions-row">
                        <button
                            type="button"
                            className="settings-button settings-button-secondary"
                            onClick={() => hideGame(detectedGame)}
                        >
                            Hide {detectedGame.name}
                        </button>
                    </div>
                ) : null}
            </div>

            <div className="settings-section-card">
                <h3>Where I share</h3>
                <label className="settings-toggle">
                    <input
                        type="checkbox"
                        checked={settings.share_with_friends}
                        onChange={(event) => update({ ...settings, share_with_friends: event.target.checked })}
                    />
                    Share with friends (people you have DMs with)
                </label>

                <fieldset className="activity-privacy-scope">
                    <legend className="activity-privacy-heading">Spaces</legend>
                    {scopes.map(({ scope, label }) => (
                        <label key={scope} className="settings-toggle">
                            <input
                                type="radio"
                                name="activity-space-scope"
                                checked={settings.space_scope === scope}
                                onChange={() => update({ ...settings, space_scope: scope })}
                            />
                            {label}
                        </label>
                    ))}
                </fieldset>

                {spaces.length === 0 ? (
                    <p className="settings-inline-note">You're not in any spaces.</p>
                ) : (
                    <>
                        <div className="activity-privacy-spaces-head">
                            <input
                                type="search"
                                className="settings-search"
                                placeholder="Search spaces"
                                aria-label="Search spaces"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            <button
                                type="button"
                                className="activity-privacy-link"
                                onClick={() =>
                                    update(spaces.reduce((next, space) => withSpace(next, space, false), settings))
                                }
                            >
                                Toggle all off
                            </button>
                        </div>
                        <ul className="activity-privacy-spaces">
                            {shownSpaces.map((space) => {
                                const included = isSpaceIncluded(settings, space.roomId, space.joinedCount);
                                const sources = roomAvatarSources(client, space.room, 64, false);
                                return (
                                    <li key={space.roomId} className="activity-privacy-space">
                                        <Avatar
                                            className="activity-privacy-space-avatar"
                                            name={space.name}
                                            src={sources[0] ?? null}
                                            sources={sources}
                                            seed={space.roomId}
                                        />
                                        <span className="activity-privacy-space-text">
                                            <span className="activity-privacy-space-name">{space.name}</span>
                                            <span className="activity-privacy-space-count">
                                                {space.joinedCount === 1 ? "1 member" : `${space.joinedCount} members`}
                                            </span>
                                        </span>
                                        <input
                                            type="checkbox"
                                            role="switch"
                                            className="activity-privacy-space-switch"
                                            aria-label={`Share with ${space.name}`}
                                            checked={included}
                                            onChange={(event) => update(withSpace(settings, space, event.target.checked))}
                                        />
                                    </li>
                                );
                            })}
                            {shownSpaces.length === 0 ? (
                                <li className="settings-inline-note">No spaces match.</li>
                            ) : null}
                        </ul>
                    </>
                )}
                <p className="settings-inline-note activity-privacy-audience">
                    {describeActivityAudience(settings, activityAudience(settings, spaces))}
                </p>
            </div>

            <div className="settings-section-card">
                <h3>Related settings</h3>
                <p className="settings-inline-note">See how your profile looks to others, status message and activity included.</p>
                <div className="settings-actions-row">
                    <button type="button" className="settings-button settings-button-secondary" onClick={onOpenProfile}>
                        Profile settings
                    </button>
                </div>
            </div>
        </div>
    );
}

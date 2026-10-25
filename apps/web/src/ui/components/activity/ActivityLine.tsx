import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { UserActivity } from "../../../core/activity/activityStore";
import type { ActivityGame } from "../../../core/activity/activityWire";
import { useGameIconUrl, useMinuteClock, useUserActivity } from "../../activity/useActivity";

const GAME_EMOJI = "🎮";

/** The game's own icon when it comes with one and has loaded; the controller otherwise. */
function GameIcon({ client, game }: { client?: MatrixClient | null; game: ActivityGame }): React.ReactElement {
    const url = useGameIconUrl(client, game.icon);
    return url ? <img className="activity-game-icon" src={url} alt="" draggable={false} /> : <>{GAME_EMOJI}</>;
}

/** "1h 23m", "5m"; null under a minute. */
export function formatPlayingFor(ms: number): string | null {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) {
        return null;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) {
        return `${minutes}m`;
    }
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Playing World of Warcraft · 1h 23m". */
export function activityText(activity: UserActivity, now: number): string {
    const playingFor = formatPlayingFor(now - activity.startedAt);
    return playingFor ? `Playing ${activity.game.name} · ${playingFor}` : `Playing ${activity.game.name}`;
}

/** What someone is playing and for how long, if they share it with us; nothing otherwise. */
export function ActivityLine({
    client,
    userId,
    className,
}: {
    /** For the game's icon; without it the line shows the controller. */
    client?: MatrixClient | null;
    userId: string | null | undefined;
    className?: string;
}): React.ReactElement | null {
    const activity = useUserActivity(userId);
    const now = useMinuteClock(activity !== null);
    if (!activity) {
        return null;
    }
    const text = activityText(activity, now);
    return (
        <p className={`activity-line${className ? ` ${className}` : ""}`} title={text}>
            <span className="activity-line-icon" aria-hidden="true">
                <GameIcon client={client} game={activity.game} />
            </span>
            <span className="activity-line-text">{text}</span>
        </p>
    );
}

/** The game's icon, or a small controller, next to a name while its owner shares what they're playing with us. */
export function ActivityIcon({ client, userId }: { client?: MatrixClient | null; userId: string }): React.ReactElement | null {
    const activity = useUserActivity(userId);
    if (!activity) {
        return null;
    }
    const label = `Playing ${activity.game.name}`;
    return (
        <span className="activity-icon" role="img" aria-label={label} title={label}>
            <GameIcon client={client} game={activity.game} />
        </span>
    );
}

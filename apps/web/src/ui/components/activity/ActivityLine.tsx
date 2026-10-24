import React from "react";

import type { UserActivity } from "../../../core/activity/activityStore";
import { useMinuteClock, useUserActivity } from "../../activity/useActivity";

const GAME_ICON = "🎮";

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
    userId,
    className,
}: {
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
                {GAME_ICON}
            </span>
            <span className="activity-line-text">{text}</span>
        </p>
    );
}

/** A small controller next to a name while its owner shares what they're playing with us. */
export function ActivityIcon({ userId }: { userId: string }): React.ReactElement | null {
    const activity = useUserActivity(userId);
    if (!activity) {
        return null;
    }
    const label = `Playing ${activity.game.name}`;
    return (
        <span className="activity-icon" role="img" aria-label={label} title={label}>
            {GAME_ICON}
        </span>
    );
}

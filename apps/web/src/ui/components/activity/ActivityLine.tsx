import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { UserActivity } from "../../../core/activity/activityStore";
import type { ActivityGame, ActivityMusic } from "../../../core/activity/activityWire";
import { useGameIconUrl, useMinuteClock, useUserActivity } from "../../activity/useActivity";

const GAME_EMOJI = "🎮";
const MUSIC_EMOJI = "🎵";

/** The game's own icon when it comes with one and has loaded; the controller otherwise. */
export function GameIcon({ client, game }: { client?: MatrixClient | null; game: ActivityGame }): React.ReactElement {
    const url = useGameIconUrl(client, game.icon);
    return url ? <img className="activity-game-icon" src={url} alt="" draggable={false} /> : <>{GAME_EMOJI}</>;
}

/** The track's cover when it comes with one and has loaded; a note otherwise. */
export function MusicCover({ client, music }: { client?: MatrixClient | null; music: ActivityMusic }): React.ReactElement {
    const url = useGameIconUrl(client, music.cover);
    return url ? <img className="activity-game-icon activity-music-cover" src={url} alt="" draggable={false} /> : <>{MUSIC_EMOJI}</>;
}

/** The game when there is one, else the music: for places with room for one thing. */
export function ActivityGlyph({ client, activity }: { client?: MatrixClient | null; activity: UserActivity }): React.ReactElement | null {
    if (activity.game) {
        return <GameIcon client={client} game={activity.game} />;
    }
    return activity.music ? <MusicCover client={client} music={activity.music} /> : null;
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
export function gameText(game: ActivityGame, startedAt: number, now: number): string {
    const playingFor = formatPlayingFor(now - startedAt);
    return playingFor ? `Playing ${game.name} · ${playingFor}` : `Playing ${game.name}`;
}

/** "Listening to Song by Artist". */
export function musicTitle(music: ActivityMusic): string {
    return music.artist ? `Listening to ${music.title} by ${music.artist}` : `Listening to ${music.title}`;
}

/** "Listening to Song by Artist · Spotify". */
export function musicText(music: ActivityMusic): string {
    return `${musicTitle(music)} · ${music.player.name}`;
}

/** The game when there is one, else the music, as one line of text. */
export function activityText(activity: UserActivity, now: number): string {
    if (activity.game) {
        return gameText(activity.game, activity.startedAt, now);
    }
    return activity.music ? musicText(activity.music) : "";
}

/** The game or music without the time: "Playing World of Warcraft", "Listening to Song by Artist". */
export function shortActivityText(activity: UserActivity): string {
    if (activity.game) {
        return `Playing ${activity.game.name}`;
    }
    return activity.music ? musicTitle(activity.music) : "";
}

/** What someone is playing and for how long, and what they listen to, if they share it with us; nothing otherwise. */
export function ActivityLine({
    client,
    userId,
    className,
}: {
    /** For the game's icon and the cover; without it the line shows a controller or a note. */
    client?: MatrixClient | null;
    userId: string | null | undefined;
    className?: string;
}): React.ReactElement | null {
    const activity = useUserActivity(userId);
    const now = useMinuteClock(Boolean(activity?.game));
    if (!activity) {
        return null;
    }
    const lineClass = `activity-line${className ? ` ${className}` : ""}`;
    return (
        <>
            {activity.game ? (
                <p className={lineClass} title={gameText(activity.game, activity.startedAt, now)}>
                    <span className="activity-line-icon" aria-hidden="true">
                        <GameIcon client={client} game={activity.game} />
                    </span>
                    <span className="activity-line-text">{gameText(activity.game, activity.startedAt, now)}</span>
                </p>
            ) : null}
            {activity.music ? (
                <p className={`${lineClass} is-music`} title={musicText(activity.music)}>
                    <span className="activity-line-icon" aria-hidden="true">
                        <MusicCover client={client} music={activity.music} />
                    </span>
                    <span className="activity-line-text">{musicText(activity.music)}</span>
                </p>
            ) : null}
        </>
    );
}

/** The game's icon, or the cover or a note for music, next to a name while its owner shares it with us. */
export function ActivityIcon({ client, userId }: { client?: MatrixClient | null; userId: string }): React.ReactElement | null {
    const activity = useUserActivity(userId);
    if (!activity) {
        return null;
    }
    const label = activity.game && activity.music ? `${shortActivityText(activity)} · ${musicTitle(activity.music)}` : shortActivityText(activity);
    return (
        <span className="activity-icon" role="img" aria-label={label} title={label}>
            <ActivityGlyph client={client} activity={activity} />
        </span>
    );
}

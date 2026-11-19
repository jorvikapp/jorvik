import { useEffect, useState } from "react";

import { cleanMusic, sameMusic, type ActivityMusic } from "../../core/activity/activityWire";

/** A track the desktop app sees playing; `key` is how the desktop app knows it, to ask for its cover. */
export interface DetectedMusic {
    key: string;
    music: ActivityMusic;
}

/** The desktop app's report of a track as music for activity; null when it isn't usable. */
export function toDetectedMusic(raw: unknown): DetectedMusic | null {
    const track = raw as { key?: unknown; player?: unknown; title?: unknown; artist?: unknown; album?: unknown } | null;
    if (!track || typeof track.key !== "string" || track.key.length === 0 || track.key.length > 1024) {
        return null;
    }
    const music = cleanMusic({ player: track.player, title: track.title, artist: track.artist ?? undefined, album: track.album ?? undefined });
    return music ? { key: track.key, music } : null;
}

/**
 * The music the desktop app sees playing, while the user shares it; null otherwise, and always in a
 * browser, which can't see other apps or tabs.
 */
export function useMusicDetection(enabled: boolean): DetectedMusic | null {
    const [detected, setDetected] = useState<DetectedMusic | null>(null);

    useEffect(() => {
        const bridge = typeof window === "undefined" ? undefined : window.heorotDesktop;
        if (!bridge?.setMusicActivityEnabled || !bridge.onMusicActivity) {
            setDetected(null);
            return;
        }
        if (!enabled) {
            // A reload skips the cleanup below, so make sure the desktop app has stopped looking.
            void bridge.setMusicActivityEnabled(false).catch(() => undefined);
            setDetected(null);
            return;
        }

        let active = true;
        const follow = (raw: unknown): void => {
            const next = toDetectedMusic(raw);
            setDetected((current) => (current?.key === next?.key && sameMusic(current?.music, next?.music) ? current : next));
        };
        const unsubscribe = bridge.onMusicActivity((next) => follow(next));
        void bridge.setMusicActivityEnabled(true).then(
            (current) => {
                if (active) {
                    follow(current);
                }
            },
            () => undefined,
        );
        return () => {
            active = false;
            unsubscribe();
            void bridge.setMusicActivityEnabled?.(false).catch(() => undefined);
            setDetected(null);
        };
    }, [enabled]);

    return detected;
}

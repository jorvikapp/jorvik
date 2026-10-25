import { useEffect, useState } from "react";

import { cleanGame, cleanActivityText, gameIdFromName, sameGame, type ActivityGame } from "../../core/activity/activityWire";

/** The desktop app reports { id, name }; a desktop app from before ids came along reports just the name. */
export function toDetectedGame(raw: unknown): ActivityGame | null {
    if (typeof raw === "string") {
        const name = cleanActivityText(raw);
        const id = name ? gameIdFromName(name) : null;
        return name && id ? { id, name } : null;
    }
    const game = cleanGame(raw);
    return game ? { id: game.id, name: game.name } : null;
}

/**
 * The game the desktop app sees running, while the user shares their activity; null otherwise, and
 * always in a browser, which can't see other programs.
 */
export function useGameDetection(enabled: boolean): ActivityGame | null {
    const [game, setGame] = useState<ActivityGame | null>(null);

    useEffect(() => {
        const bridge = typeof window === "undefined" ? undefined : window.heorotDesktop;
        if (!bridge?.setGameActivityEnabled || !bridge.onGameActivity) {
            setGame(null);
            return;
        }
        if (!enabled) {
            // A reload skips the cleanup below, so make sure the desktop app has stopped looking.
            void bridge.setGameActivityEnabled(false).catch(() => undefined);
            setGame(null);
            return;
        }

        let active = true;
        const follow = (raw: unknown): void => {
            const next = toDetectedGame(raw);
            setGame((current) => (sameGame(current, next) ? current : next));
        };
        const unsubscribe = bridge.onGameActivity((next) => follow(next));
        void bridge.setGameActivityEnabled(true).then(
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
            void bridge.setGameActivityEnabled?.(false).catch(() => undefined);
            setGame(null);
        };
    }, [enabled]);

    return game;
}

import { useEffect, useState } from "react";

/**
 * The game the desktop app sees running, while the user has game activity turned on; null
 * otherwise, and always in a browser, which can't see other programs.
 */
export function useGameActivity(enabled: boolean): string | null {
    const [game, setGame] = useState<string | null>(null);

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
        const unsubscribe = bridge.onGameActivity((next) => setGame(next));
        void bridge.setGameActivityEnabled(true).then(
            (current) => {
                if (active) {
                    setGame(current);
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

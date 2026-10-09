import { useEffect, useState } from "react";

import { localDayKey } from "./messageTime";

/**
 * The current date, renewed when the local day changes, so "Today" becomes
 * "Yesterday" at midnight in a chat left open. Checked again when the window comes
 * back, because a timer can fire late after the computer sleeps through midnight.
 */
export function useCurrentDay(): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const refresh = (): void => {
            setNow((current) => (localDayKey(current.getTime()) === localDayKey(Date.now()) ? current : new Date()));
        };
        const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
        const timer = setTimeout(refresh, Math.max(1_000, nextMidnight.getTime() - Date.now()));
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [now]);

    return now;
}

import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { twitchStream, type TwitchStream } from "../../../../core/users/twitchLive";

const RECHECK_MS = 60_000;

/** Whether this Twitch channel is live, checked again every minute while it's on screen. */
export function useTwitchStream(client: MatrixClient | null | undefined, login: string | null): TwitchStream | null {
    const [stream, setStream] = useState<TwitchStream | null>(null);
    useEffect(() => {
        setStream(null);
        if (!client || !login) {
            return;
        }
        let cancelled = false;
        const check = (): void => {
            void twitchStream(client, login).then((next) => {
                if (!cancelled) {
                    setStream(next);
                }
            });
        };
        check();
        const timer = window.setInterval(check, RECHECK_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [client, login]);
    return stream;
}

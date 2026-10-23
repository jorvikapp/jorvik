import { useCallback, useEffect, useState } from "react";
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * How far the Notifications tab's mentions have been cleared: the time of the newest one
 * cleared. It lives in account data, so clearing them on one phone clears them on the others.
 */
export const MENTIONS_CLEARED_EVENT_TYPE = "app.jorvik.mentions_cleared";

/** Account data is user-writable from any client, so trust none of it. */
export function normalizeClearedUpTo(content: unknown): number {
    const value = content && typeof content === "object" ? (content as { cleared_up_to?: unknown }).cleared_up_to : undefined;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function readClearedUpTo(client: MatrixClient): number {
    return normalizeClearedUpTo(client.getAccountData(MENTIONS_CLEARED_EVENT_TYPE as any)?.getContent());
}

export interface ClearedMentionsController {
    /** Mentions sent at or before this time are cleared; 0 if none have been. */
    clearedUpTo: number;
    /** Clears every mention sent at or before `ts`. Rejects, and shows them again, if that can't be saved. */
    clearUpTo: (ts: number) => Promise<void>;
}

export function useClearedMentions(client: MatrixClient): ClearedMentionsController {
    const [clearedUpTo, setClearedUpTo] = useState(() => readClearedUpTo(client));

    // Another device, or this one, cleared them.
    useEffect(() => {
        setClearedUpTo(readClearedUpTo(client));
        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === MENTIONS_CLEARED_EVENT_TYPE) {
                setClearedUpTo(normalizeClearedUpTo(event.getContent()));
            }
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    const clearUpTo = useCallback(
        async (ts: number): Promise<void> => {
            // Never brings back what an earlier clear hid.
            const next = Math.max(ts, readClearedUpTo(client));
            setClearedUpTo(next);
            try {
                await client.setAccountData(MENTIONS_CLEARED_EVENT_TYPE as any, { cleared_up_to: next } as any);
            } catch (error) {
                setClearedUpTo(readClearedUpTo(client));
                throw error;
            }
        },
        [client],
    );

    return { clearedUpTo, clearUpTo };
}

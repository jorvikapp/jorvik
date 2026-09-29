import { useCallback, useEffect, useState } from "react";
import { ClientEvent, EventType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

export interface IgnoredUsersController {
    ignoredUserIds: string[];
    isIgnored: (userId: string) => boolean;
    setIgnored: (userId: string, ignored: boolean) => Promise<void>;
}

/**
 * Blocking is Matrix's ignore list (m.ignored_user_list): the homeserver stops
 * sending that user's events and invites, and the other person is not told.
 * Messages already loaded are hidden by the timeline itself.
 */
export function useIgnoredUsers(client: MatrixClient): IgnoredUsersController {
    const [ignoredUserIds, setIgnoredUserIds] = useState<string[]>(() => client.getIgnoredUsers());

    useEffect(() => {
        setIgnoredUserIds(client.getIgnoredUsers());
        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === EventType.IgnoredUserList) {
                setIgnoredUserIds(client.getIgnoredUsers());
            }
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    const isIgnored = useCallback((userId: string) => ignoredUserIds.includes(userId), [ignoredUserIds]);

    const setIgnored = useCallback(
        async (userId: string, ignored: boolean): Promise<void> => {
            const current = client.getIgnoredUsers();
            const next = ignored ? [...new Set([...current, userId])] : current.filter((id) => id !== userId);
            await client.setIgnoredUsers(next);
            setIgnoredUserIds(next);
        },
        [client],
    );

    return { ignoredUserIds, isIgnored, setIgnored };
}

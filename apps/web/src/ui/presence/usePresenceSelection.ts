import { useCallback, useEffect, useRef, useState } from "react";
import { ClientEvent, SyncState, type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    applyPresenceSelection,
    resetPresencePublishState,
    loadPresenceSelection,
    sanitizeStatusMessage,
    savePresenceSelection,
    type PresenceChoice,
    type PresenceSelection,
} from "../../core/presence/presenceControl";

export interface PresenceSelectionController {
    selection: PresenceSelection;
    setChoice: (choice: PresenceChoice) => void;
    setStatusMessage: (statusMessage: string) => void;
    error: string | null;
}

/**
 * Owns the user's chosen presence and keeps the homeserver in step with it.
 *
 * The selection is re-applied after every reconnect: a fresh sync makes the
 * server assert its own view of presence, which would otherwise quietly undo
 * "Invisible" or "Idle" the first time the connection drops.
 */
export function usePresenceSelection(
    client: MatrixClient | null,
    enabled: boolean,
): PresenceSelectionController {
    const [selection, setSelection] = useState<PresenceSelection>(() => loadPresenceSelection());
    const [error, setError] = useState<string | null>(null);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    const publish = useCallback(
        (next: PresenceSelection): void => {
            if (!client || !enabled) {
                return;
            }

            void applyPresenceSelection(client, next).then(
                () => setError(null),
                (publishError: unknown) => {
                    const candidate = publishError as { errcode?: string; httpStatus?: number };
                    const rateLimited =
                        candidate?.errcode === "M_LIMIT_EXCEEDED" || candidate?.httpStatus === 429;
                    setError(
                        rateLimited
                            ? "The server is rate limiting status changes. Try again in a few seconds."
                            : publishError instanceof Error
                              ? publishError.message
                              : "Could not update status.",
                    );
                },
            );
        },
        [client, enabled],
    );

    // Apply the stored selection on startup, and again after any reconnect.
    useEffect(() => {
        if (!client || !enabled) {
            return;
        }

        publish(selectionRef.current);

        let wasDisconnected = false;
        const onSync = (state: SyncState): void => {
            if (state === SyncState.Error || state === SyncState.Reconnecting) {
                wasDisconnected = true;
                return;
            }
            if (state === SyncState.Syncing && wasDisconnected) {
                wasDisconnected = false;
                publish(selectionRef.current);
            }
        };

        client.on(ClientEvent.Sync, onSync);
        return () => {
            client.removeListener(ClientEvent.Sync, onSync);
            resetPresencePublishState();
        };
    }, [client, enabled, publish]);

    const setChoice = useCallback(
        (choice: PresenceChoice): void => {
            const next: PresenceSelection = { ...selectionRef.current, choice };
            setSelection(next);
            savePresenceSelection(next);
            publish(next);
        },
        [publish],
    );

    const setStatusMessage = useCallback(
        (statusMessage: string): void => {
            const next: PresenceSelection = {
                ...selectionRef.current,
                statusMessage: sanitizeStatusMessage(statusMessage),
            };
            setSelection(next);
            savePresenceSelection(next);
            publish(next);
        },
        [publish],
    );

    return { selection, setChoice, setStatusMessage, error };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    /** What is published: the selection, or Idle while auto-idle applies. */
    effectiveChoice: PresenceChoice;
    autoIdle: boolean;
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
 *
 * While `away` is true an Online selection is published as Idle, without
 * changing or saving the selection itself; the other choices are left alone.
 */
export function usePresenceSelection(
    client: MatrixClient | null,
    enabled: boolean,
    away = false,
): PresenceSelectionController {
    const [selection, setSelection] = useState<PresenceSelection>(() => loadPresenceSelection());
    const [error, setError] = useState<string | null>(null);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const autoIdle = away && selection.choice === "online";
    const effective = useMemo<PresenceSelection>(
        () => (autoIdle ? { ...selection, choice: "idle" } : selection),
        [autoIdle, selection],
    );
    const effectiveRef = useRef(effective);
    effectiveRef.current = effective;

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

    // Publish on startup and whenever the choice, the message or auto-idle changes.
    useEffect(() => {
        publish(effective);
    }, [effective, publish]);

    // Apply it again after any reconnect.
    useEffect(() => {
        if (!client || !enabled) {
            return;
        }

        let wasDisconnected = false;
        const onSync = (state: SyncState): void => {
            if (state === SyncState.Error || state === SyncState.Reconnecting) {
                wasDisconnected = true;
                return;
            }
            if (state === SyncState.Syncing && wasDisconnected) {
                wasDisconnected = false;
                publish(effectiveRef.current);
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
        },
        [],
    );

    const setStatusMessage = useCallback(
        (statusMessage: string): void => {
            const next: PresenceSelection = {
                ...selectionRef.current,
                statusMessage: sanitizeStatusMessage(statusMessage),
            };
            setSelection(next);
            savePresenceSelection(next);
        },
        [],
    );

    return { selection, effectiveChoice: effective.choice, autoIdle, setChoice, setStatusMessage, error };
}

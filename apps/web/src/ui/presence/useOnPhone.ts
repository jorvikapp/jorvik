import { useEffect, useSyncExternalStore } from "react";
import { UserEvent, type MatrixClient, type MatrixEvent, type User } from "matrix-js-sdk/src/matrix";

import { OnPhoneStore, startOnPhoneWriter } from "../../core/presence/onPhone";

// One store for the signed-in client; avatars anywhere read it without the client being passed down.
let current: OnPhoneStore | null = null;
const swapListeners = new Set<() => void>();

function setCurrent(store: OnPhoneStore | null): void {
    current = store;
    for (const listener of swapListeners) {
        listener();
    }
}

/** AppShell runs this once per client: the store, this device's own answer, and presence-change refreshes. */
export function useOnPhoneService(client: MatrixClient): void {
    useEffect(() => {
        const store = new OnPhoneStore(client);
        setCurrent(store);
        const stopWriter = startOnPhoneWriter(client, store);
        const onPresence = (_event: MatrixEvent | undefined, user: User): void => store.invalidate(user.userId);
        client.on(UserEvent.Presence, onPresence);
        return () => {
            client.off(UserEvent.Presence, onPresence);
            stopWriter();
            store.stop();
            if (current === store) {
                setCurrent(null);
            }
        };
    }, [client]);
}

const NO_STORE = (): (() => void) => () => undefined;

/** True while this person is using Jorvik on a phone. Only asks while `enabled` (they show as online). */
export function useOnPhone(userId: string | undefined, enabled: boolean): boolean {
    const store = useSyncExternalStore(
        (onChange) => {
            swapListeners.add(onChange);
            return () => swapListeners.delete(onChange);
        },
        () => current,
        () => null,
    );
    const active = enabled && !!userId && !!store;
    useEffect(() => (active ? store!.watch(userId!) : undefined), [active, store, userId]);
    return useSyncExternalStore(
        store ? store.subscribe : NO_STORE,
        () => (active ? store!.isOnPhone(userId!) : false),
        () => false,
    );
}

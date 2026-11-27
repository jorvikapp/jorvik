import React, { useEffect, useState } from "react";
import { ClientEvent, SyncState, type MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * After this long without the server, the app says so with a full screen instead of quietly failing.
 * A server restart or a phone waking up is over well before it.
 */
export const DISCONNECTED_SCREEN_AFTER_MS = 2 * 60_000;

/** Jorvik's status page; only offered to people on Jorvik's own server. */
export const JORVIK_STATUS_URL = "https://status.jorvik.app";

/** A sync answered: the server is there. */
const CONTACT_STATES = new Set<SyncState | null>([SyncState.Syncing, SyncState.Prepared, SyncState.Catchup]);

/** A gap this long between one-second ticks means the computer slept; don't count that as the server away. */
const SLEEP_GAP_MS = 15_000;

/**
 * When the server last answered a sync (which it does at least every half minute while all is well), and
 * the current time, ticking each second. This counts a server that stopped answering as gone too, not only
 * one that refuses the connection: a frozen server sends no error, so sync takes over a minute to fail.
 * Waking from sleep starts the count again. `lastContact` is null while the client isn't syncing at all.
 */
export function useServerContact(client: MatrixClient): { lastContact: number | null; now: number } {
    const [lastContact, setLastContact] = useState<number | null>(() =>
        client.getSyncState() === SyncState.Stopped ? null : Date.now(),
    );
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const onSync = (state: SyncState): void => {
            if (CONTACT_STATES.has(state)) {
                setLastContact(Date.now());
            } else if (state === SyncState.Stopped) {
                setLastContact(null);
            }
        };
        client.on(ClientEvent.Sync, onSync);
        let previousTick = Date.now();
        const timer = setInterval(() => {
            const tick = Date.now();
            if (tick - previousTick > SLEEP_GAP_MS) {
                setLastContact((current) => (current === null ? null : tick));
            }
            previousTick = tick;
            setNow(tick);
        }, 1000);
        return () => {
            client.off(ClientEvent.Sync, onSync);
            clearInterval(timer);
        };
    }, [client]);
    return { lastContact, now };
}

function useBrowserOnline(): boolean {
    const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
    useEffect(() => {
        const update = (): void => setOnline(navigator.onLine);
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    }, []);
    return online;
}

function isJorvikServer(client: MatrixClient): boolean {
    try {
        const host = new URL(client.getHomeserverUrl()).hostname;
        return host === "jorvik.app" || host.endsWith(".jorvik.app");
    } catch {
        return false;
    }
}

/**
 * The full screen shown when the server hasn't answered for DISCONNECTED_SCREEN_AFTER_MS. It goes away by
 * itself when the server answers. "Keep reading" hides it until the server has answered again and gone again.
 */
export function ServerDisconnected({
    client,
    afterMs = DISCONNECTED_SCREEN_AFTER_MS,
}: {
    client: MatrixClient;
    afterMs?: number;
}): React.ReactElement | null {
    const { lastContact, now } = useServerContact(client);
    const online = useBrowserOnline();
    const [hiddenFor, setHiddenFor] = useState<number | null>(null);
    const [trying, setTrying] = useState(false);

    useEffect(() => {
        setTrying(false);
    }, [lastContact]);

    if (lastContact === null || now - lastContact < afterMs || hiddenFor === lastContact) {
        return null;
    }

    const tryAgain = (): void => {
        setTrying(true);
        client.retryImmediately();
        window.setTimeout(() => setTrying(false), 4000);
    };

    return (
        <div className="server-disconnected" role="alertdialog" aria-labelledby="server-disconnected-title">
            <div className="server-disconnected-card">
                <div className="loading-spinner" aria-hidden="true" />
                <h2 id="server-disconnected-title">
                    {online ? "Disconnected from the server" : "You're offline"}
                </h2>
                <p>
                    {online
                        ? "Jorvik can't reach the server right now. It keeps trying, and anything you sent goes out once it's back."
                        : "Check your internet connection. Jorvik reconnects by itself, and anything you sent goes out once it's back."}
                </p>
                <div className="server-disconnected-actions">
                    <button type="button" className="server-disconnected-primary" onClick={tryAgain} disabled={trying}>
                        {trying ? "Trying..." : "Try again"}
                    </button>
                    {online && isJorvikServer(client) ? (
                        <a
                            className="server-disconnected-secondary"
                            href={JORVIK_STATUS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Check server status
                        </a>
                    ) : null}
                </div>
                <button type="button" className="server-disconnected-dismiss" onClick={() => setHiddenFor(lastContact)}>
                    Keep reading
                </button>
            </div>
        </div>
    );
}

import type { MatrixClient } from "matrix-js-sdk/src/matrix";

export type StateEventRequest = (roomId: string, eventType: string, stateKey: string) => Promise<unknown>;

export interface StateEventDeduper {
    get(roomId: string, eventType: string, stateKey: string): Promise<unknown>;
    readonly inFlightCount: number;
}

/**
 * Collapses concurrent requests for the same state event into one.
 *
 * AppShell and RoomList each want authoritative values for the same singleton state
 * events on the same space, and previously each downloaded the room's entire state to get
 * them. Sharing the in-flight promise means simultaneous callers cost one request.
 *
 * Only in-flight requests are shared -- nothing is retained after settling -- so this
 * never serves a stale value, and a failed request is retried by the next caller rather
 * than caching the failure.
 */
export function createStateEventDeduper(request: StateEventRequest): StateEventDeduper {
    const inFlight = new Map<string, Promise<unknown>>();

    return {
        get inFlightCount(): number {
            return inFlight.size;
        },

        get(roomId: string, eventType: string, stateKey: string): Promise<unknown> {
            const key = `${roomId}|${eventType}|${stateKey}`;
            const existing = inFlight.get(key);
            if (existing) {
                return existing;
            }

            const pending = request(roomId, eventType, stateKey).finally(() => {
                inFlight.delete(key);
            });
            inFlight.set(key, pending);
            return pending;
        },
    };
}

/**
 * One deduper per client, so callers in different components share in-flight requests.
 * Keyed weakly, so it cannot keep a logged-out client alive.
 */
const dedupersByClient = new WeakMap<MatrixClient, StateEventDeduper>();

export function sharedStateEventDeduperFor(client: MatrixClient): StateEventDeduper {
    const existing = dedupersByClient.get(client);
    if (existing) {
        return existing;
    }

    const deduper = createStateEventDeduper((roomId, eventType, stateKey) =>
        client.getStateEvent(roomId, eventType, stateKey),
    );
    dedupersByClient.set(client, deduper);
    return deduper;
}

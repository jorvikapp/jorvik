import { ClientEvent, EventType, type MatrixClient } from "matrix-js-sdk/src/matrix";

const SPACE_CHILD_SYNC_TIMEOUT_MS = 10_000;

function hasSpaceChild(client: MatrixClient, spaceId: string, childRoomId: string): boolean {
    const space = client.getRoom(spaceId);
    return Boolean(client.getRoom(childRoomId) && space?.currentState.getStateEvents(EventType.SpaceChild, childRoomId));
}

/**
 * True once this client has a new room and its space's m.space.child for it. The
 * requests that make them return before a sync brings them here, and until then
 * the space doesn't list the room, so going to it straight away finds no space to
 * show it in. False if they haven't arrived in time.
 */
export async function waitForSpaceChild(
    client: MatrixClient,
    spaceId: string,
    childRoomId: string,
    timeoutMs = SPACE_CHILD_SYNC_TIMEOUT_MS,
): Promise<boolean> {
    if (hasSpaceChild(client, spaceId, childRoomId)) {
        return true;
    }

    return new Promise<boolean>((resolve) => {
        const timeoutId = window.setTimeout(() => {
            client.removeListener(ClientEvent.Sync, onSync);
            resolve(false);
        }, timeoutMs);

        const onSync = (): void => {
            if (hasSpaceChild(client, spaceId, childRoomId)) {
                client.removeListener(ClientEvent.Sync, onSync);
                window.clearTimeout(timeoutId);
                resolve(true);
            }
        };

        client.on(ClientEvent.Sync, onSync);
    });
}

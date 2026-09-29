import { Method, type MatrixClient } from "matrix-js-sdk/src/matrix";

/** Synapse rejects longer reasons. */
export const MAX_REPORT_REASON_LENGTH = 1000;

/**
 * Reports go to the admins of the reporter's homeserver. Synapse keeps a user
 * report only when that user is on the same server; others are dropped while
 * still answering 200, so callers should check isUserOnOwnServer first.
 */
export async function reportUser(client: MatrixClient, userId: string, reason: string): Promise<void> {
    await client.http.authedRequest(Method.Post, `/users/${encodeURIComponent(userId)}/report`, undefined, { reason });
}

/** Message reports are kept for any sender, and admin panels list them. */
export async function reportMessage(client: MatrixClient, roomId: string, eventId: string, reason: string): Promise<void> {
    await client.http.authedRequest(
        Method.Post,
        `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}`,
        undefined,
        { reason },
    );
}

export function serverNameOf(userId: string): string {
    return userId.slice(userId.indexOf(":") + 1);
}

export function isUserOnOwnServer(client: MatrixClient, userId: string): boolean {
    const ownDomain = client.getDomain();
    return Boolean(ownDomain) && serverNameOf(userId) === ownDomain;
}

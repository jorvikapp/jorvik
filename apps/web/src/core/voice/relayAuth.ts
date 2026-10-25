import type { MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * How Jorvik proves who the user is to the relay (voice and GIFs): with an OpenID token from their
 * homeserver. That token only lets the relay ask the homeserver for the user's ID, so the Matrix access
 * token, which opens the whole account, never goes to the relay.
 */

interface RelayCredentials {
    token: string;
    serverName: string;
    expiresAt: number;
}

/** A token is replaced this long before the homeserver says it runs out (Synapse's last an hour). */
const RENEW_BEFORE_MS = 5 * 60_000;

const credentialsByClient = new WeakMap<MatrixClient, Promise<RelayCredentials>>();

function requestCredentials(client: MatrixClient): Promise<RelayCredentials> {
    const request = client.getOpenIdToken().then((openId) => ({
        token: openId.access_token,
        serverName: openId.matrix_server_name,
        expiresAt: Date.now() + openId.expires_in * 1000,
    }));
    credentialsByClient.set(client, request);
    request.catch(() => {
        if (credentialsByClient.get(client) === request) {
            credentialsByClient.delete(client);
        }
    });
    return request;
}

/** The headers that say who's asking, from a token asked for once and kept until shortly before it runs out. */
export async function relayAuthHeaders(client: MatrixClient): Promise<Record<string, string>> {
    let credentials = await (credentialsByClient.get(client) ?? requestCredentials(client));
    if (credentials.expiresAt - RENEW_BEFORE_MS <= Date.now()) {
        credentials = await requestCredentials(client);
    }
    return { "X-Matrix-OpenID-Token": credentials.token, "X-Matrix-Server-Name": credentials.serverName };
}

/** Drops the kept token, for when the relay refuses it. */
export function forgetRelayCredentials(client: MatrixClient): void {
    credentialsByClient.delete(client);
}

async function errorCode(response: Response): Promise<unknown> {
    try {
        return ((await response.clone().json()) as { error_code?: unknown } | null)?.error_code;
    } catch {
        return undefined;
    }
}

/** fetch to the relay as the user; a token the relay no longer accepts is replaced once. */
export async function fetchFromRelay(client: MatrixClient, url: string, init: RequestInit = {}): Promise<Response> {
    const send = async (): Promise<Response> =>
        fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(await relayAuthHeaders(client)) } });
    const response = await send();
    if (response.status === 401 && (await errorCode(response)) === "invalid_openid_token") {
        forgetRelayCredentials(client);
        return send();
    }
    return response;
}

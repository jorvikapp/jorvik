/**
 * Fired whenever the access token is rotated.
 *
 * The desktop media service worker is handed the access token over IPC and
 * holds it until told otherwise. Tokens rotate every few minutes, so without
 * this the worker keeps a token the server has already rejected and every
 * media request it rewrites comes back 401 - which reads as missing avatars,
 * not as an auth failure.
 */
const ACCESS_TOKEN_ROTATED_EVENT = "heorot:access-token-rotated";

export function emitAccessTokenRotated(): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new CustomEvent(ACCESS_TOKEN_ROTATED_EVENT));
}

export function subscribeAccessTokenRotated(listener: () => void): () => void {
    if (typeof window === "undefined") {
        return () => {};
    }

    const handler = (): void => {
        listener();
    };

    window.addEventListener(ACCESS_TOKEN_ROTATED_EVENT, handler);
    return () => {
        window.removeEventListener(ACCESS_TOKEN_ROTATED_EVENT, handler);
    };
}

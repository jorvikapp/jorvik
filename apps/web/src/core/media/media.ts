import type { MatrixClient, ResizeMethod } from "matrix-js-sdk/src/matrix";

function toDevicePixels(size: number): number {
    const pixelRatio = typeof window === "undefined" ? 1 : Math.max(window.devicePixelRatio || 1, 1);
    return Math.max(1, Math.floor(size * pixelRatio));
}

export function thumbnailFromMxc(
    client: MatrixClient,
    mxc: string | null | undefined,
    width: number,
    height: number,
    resizeMethod: ResizeMethod = "crop",
): string | null {
    if (!mxc) {
        return null;
    }

    // Match Matrix spec/client behavior: fetch media through Matrix media APIs, not direct links.
    // Deliberately NOT passing useAuthentication. An unauthenticated
    // /_matrix/media/v3/ URL loads on its own, and the media service worker
    // upgrades it to /_matrix/client/v1/media/ with a token when it is
    // controlling the page. Requesting the authenticated URL directly inverts
    // that: an <img> cannot set an Authorization header, so if the worker is
    // not controlling - which happens on a first load, after a storage reset,
    // or in private browsing - every image 401s with no way to recover.
    return client.mxcUrlToHttp(
        mxc,
        toDevicePixels(width),
        toDevicePixels(height),
        resizeMethod,
        false,
        true,
    );
}

export function mediaFromMxc(client: MatrixClient, mxc: string | null | undefined): string | null {
    if (!mxc) {
        return null;
    }

    // Use the regular media endpoint so <img> can load it directly in the browser.
    return client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true);
}

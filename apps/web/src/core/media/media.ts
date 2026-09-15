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
    // The 7th argument is useAuthentication. Without it matrix-js-sdk builds
    // /_matrix/media/v3/ URLs, and Synapse no longer serves that route at all -
    // it 404s with an unknown-endpoint error, so every image and avatar breaks.
    // The media service worker attaches the token, and downgrades back to the
    // legacy path if a server turns out not to support authenticated media.
    return client.mxcUrlToHttp(
        mxc,
        toDevicePixels(width),
        toDevicePixels(height),
        resizeMethod,
        false,
        true,
        true,
    );
}

export function mediaFromMxc(client: MatrixClient, mxc: string | null | undefined): string | null {
    if (!mxc) {
        return null;
    }

    // Use the regular media endpoint so <img> can load it directly in the browser.
    return client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
}

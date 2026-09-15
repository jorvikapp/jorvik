import { describe, expect, it, vi } from "vitest";

import { mediaFromMxc, thumbnailFromMxc } from "../../../../src/core/media/media";
import { mxcThumbnailToHttp, mxcToHttp } from "../../../../src/ui/utils/mxc";

/**
 * mxcUrlToHttp's 7th positional argument is useAuthentication. Passing true
 * makes the SDK emit /_matrix/client/v1/media/ URLs, which require an
 * Authorization header - and an <img> cannot set one. Those requests only
 * succeed while the media service worker is controlling the page, so a first
 * load, a storage reset or private browsing turns every image into a 401 with
 * no fallback.
 *
 * Unauthenticated /_matrix/media/v3/ URLs load on their own and the worker
 * upgrades them when it can, so they degrade gracefully in both directions.
 * These tests pin that choice, because it was reverted once already.
 */
const USE_AUTHENTICATION_ARG = 6;

function makeClient() {
    return { mxcUrlToHttp: vi.fn(() => "https://example.org/media") };
}

function assertNotForcingAuthenticated(client: ReturnType<typeof makeClient>) {
    expect(client.mxcUrlToHttp).toHaveBeenCalled();
    expect(client.mxcUrlToHttp.mock.calls[0][USE_AUTHENTICATION_ARG]).not.toBe(true);
}

describe("media URL helpers", () => {
    it("does not force authenticated URLs for full media", () => {
        const client = makeClient();
        mediaFromMxc(client as any, "mxc://example.org/abc");
        assertNotForcingAuthenticated(client);
    });

    it("does not force authenticated URLs for thumbnails", () => {
        const client = makeClient();
        thumbnailFromMxc(client as any, "mxc://example.org/abc", 64, 64);
        assertNotForcingAuthenticated(client);
    });

    it("does not force authenticated URLs from the ui mxc helpers", () => {
        const full = makeClient();
        mxcToHttp(full as any, "mxc://example.org/abc");
        assertNotForcingAuthenticated(full);

        const thumb = makeClient();
        mxcThumbnailToHttp(thumb as any, "mxc://example.org/abc", 28, 28);
        assertNotForcingAuthenticated(thumb);
    });

    it("returns null for a missing mxc without calling the client", () => {
        const client = makeClient();
        expect(mediaFromMxc(client as any, null)).toBeNull();
        expect(thumbnailFromMxc(client as any, undefined, 64, 64)).toBeNull();
        expect(mxcToHttp(client as any, "")).toBeNull();
        expect(client.mxcUrlToHttp).not.toHaveBeenCalled();
    });
});

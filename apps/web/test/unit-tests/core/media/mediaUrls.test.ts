import { describe, expect, it, vi } from "vitest";

import { mediaFromMxc, thumbnailFromMxc } from "../../../../src/core/media/media";
import { mxcThumbnailToHttp, mxcToHttp } from "../../../../src/ui/utils/mxc";

/**
 * mxcUrlToHttp takes useAuthentication as its 7th positional argument. Omitting
 * it silently produces /_matrix/media/v3/ URLs, which Synapse no longer serves
 * at all - so every avatar and inline image 404s. Positional arguments make
 * that easy to reintroduce, hence these tests.
 */
const USE_AUTHENTICATION_ARG = 6;

function makeClient() {
    return {
        mxcUrlToHttp: vi.fn(() => "https://example.org/media"),
    };
}

describe("media URL helpers", () => {
    it("requests authenticated URLs for full media", () => {
        const client = makeClient();
        mediaFromMxc(client as any, "mxc://example.org/abc");
        expect(client.mxcUrlToHttp.mock.calls[0][USE_AUTHENTICATION_ARG]).toBe(true);
    });

    it("requests authenticated URLs for thumbnails", () => {
        const client = makeClient();
        thumbnailFromMxc(client as any, "mxc://example.org/abc", 64, 64);
        expect(client.mxcUrlToHttp.mock.calls[0][USE_AUTHENTICATION_ARG]).toBe(true);
    });

    it("requests authenticated URLs from the ui mxc helpers", () => {
        const full = makeClient();
        mxcToHttp(full as any, "mxc://example.org/abc");
        expect(full.mxcUrlToHttp.mock.calls[0][USE_AUTHENTICATION_ARG]).toBe(true);

        const thumb = makeClient();
        mxcThumbnailToHttp(thumb as any, "mxc://example.org/abc", 28, 28);
        expect(thumb.mxcUrlToHttp.mock.calls[0][USE_AUTHENTICATION_ARG]).toBe(true);
    });

    it("returns null for a missing mxc without calling the client", () => {
        const client = makeClient();
        expect(mediaFromMxc(client as any, null)).toBeNull();
        expect(thumbnailFromMxc(client as any, undefined, 64, 64)).toBeNull();
        expect(mxcToHttp(client as any, "")).toBeNull();
        expect(client.mxcUrlToHttp).not.toHaveBeenCalled();
    });
});

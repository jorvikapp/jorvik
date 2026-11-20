import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

const fetchFromRelay = vi.fn();
vi.mock("../../../../src/core/voice/relayAuth", () => ({ fetchFromRelay: (...args: unknown[]) => fetchFromRelay(...args) }));

import { clearTwitchStreams, twitchLoginOf, twitchStream, TWITCH_LIVE_API } from "../../../../src/core/users/twitchLive";

const client = {} as MatrixClient;
const live = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
    clearTwitchStreams();
    fetchFromRelay.mockReset();
});

describe("twitchLoginOf", () => {
    it("reads the channel from a Twitch link", () => {
        expect(twitchLoginOf("https://www.twitch.tv/Xuruh")).toBe("xuruh");
        expect(twitchLoginOf("https://m.twitch.tv/xuruh/videos")).toBe("xuruh");
    });

    it("is null for other sites and Twitch pages that aren't channels", () => {
        for (const href of ["https://twitch.tv/", "https://twitch.tv/directory", "https://twitch.tv.evil.example/xuruh", "https://youtube.com/@xuruh", "https://twitch.tv/bad-name"]) {
            expect(twitchLoginOf(href), href).toBeNull();
        }
    });
});

describe("twitchStream", () => {
    it("asks the relay as the user, once a minute per channel", async () => {
        fetchFromRelay.mockImplementation(async () => live({ live: { xuruh: { title: "Raid night", game: "World of Warcraft", startedAt: "2026-11-20T10:00:00Z" } } }));
        const [a, b] = await Promise.all([twitchStream(client, "xuruh"), twitchStream(client, "xuruh")]);
        expect(a).toEqual({ title: "Raid night", game: "World of Warcraft", startedAt: "2026-11-20T10:00:00Z" });
        expect(b).toEqual(a);
        expect(await twitchStream(client, "xuruh")).toEqual(a);
        expect(fetchFromRelay).toHaveBeenCalledTimes(1);
        expect(fetchFromRelay).toHaveBeenCalledWith(client, `${TWITCH_LIVE_API}?logins=xuruh`);
        expect(await twitchStream(client, "xuruh", Date.now() + 61_000)).toEqual(a);
        expect(fetchFromRelay).toHaveBeenCalledTimes(2);
    });

    it("is null when not live, and when the relay can't say", async () => {
        fetchFromRelay.mockResolvedValueOnce(live({ live: {} }));
        expect(await twitchStream(client, "sleepy")).toBeNull();
        fetchFromRelay.mockResolvedValueOnce(live({ error: "Twitch is not configured" }, 503));
        expect(await twitchStream(client, "other")).toBeNull();
        fetchFromRelay.mockRejectedValueOnce(new Error("offline"));
        expect(await twitchStream(client, "third")).toBeNull();
    });
});

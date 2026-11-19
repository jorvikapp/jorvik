// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
    ACTIVITY_LIFETIME_MS,
    cleanActivityText,
    cleanGame,
    cleanIcon,
    contentDeviceId,
    gameIdFromName,
    parseIncomingActivity,
    playingContent,
    sameGame,
    sameMusic,
    cleanMusic,
    stoppedContent,
    type ActivityIconFile,
} from "../../../../src/core/activity/activityWire";

const NOW = 1_792_850_000_000;
const WOW = { id: "wow", name: "World of Warcraft" };
const ICON: ActivityIconFile = {
    url: "mxc://matrix.jorvik.app/AbCdEf123",
    key: { kty: "oct", alg: "A256CTR", k: "a".repeat(43), key_ops: ["encrypt", "decrypt"], ext: true },
    iv: "b".repeat(22),
    hashes: { sha256: "c".repeat(43) },
    v: "v2",
};

describe("activity messages", () => {
    it("say what's playing, since when, and until when to believe it", () => {
        expect(playingContent("DEV", { game: WOW, music: null }, NOW - 5_000, NOW)).toEqual({
            device_id: "DEV",
            game: WOW,
            started_at: NOW - 5_000,
            expires_at: NOW + ACTIVITY_LIFETIME_MS,
        });
        expect(stoppedContent("DEV")).toEqual({ device_id: "DEV", game: null });
    });

    it("read back what a sender sent", () => {
        expect(parseIncomingActivity(playingContent("DEV", { game: WOW, music: null }, NOW - 60_000, NOW), NOW + 1_000)).toEqual({
            game: WOW,
            music: null,
            startedAt: NOW - 60_000,
            expiresAt: NOW + ACTIVITY_LIFETIME_MS,
        });
        expect(parseIncomingActivity(stoppedContent("DEV"), NOW)).toEqual({ game: null, music: null, stopped: true });
    });

    it("keep names to one line of plain text, 128 characters at most", () => {
        expect(cleanActivityText("  World\n of\tWarcraft\u0000 ")).toBe("World of Warcraft");
        expect(cleanActivityText("x".repeat(300))).toHaveLength(128);
        expect(cleanActivityText("‮Warcraft")).toBe("Warcraft");
        expect(cleanActivityText(" \n ")).toBeNull();
        expect(cleanActivityText(42)).toBeNull();
    });

    it("refuse odd game ids, missing names, and expired or never-ending messages", () => {
        const base = { device_id: "DEV", started_at: NOW - 1_000, expires_at: NOW + 60_000 };
        expect(parseIncomingActivity({ ...base, game: { id: "WoW!", name: "World of Warcraft" } }, NOW)).toBeNull();
        expect(parseIncomingActivity({ ...base, game: { id: "wow", name: " " } }, NOW)).toBeNull();
        expect(parseIncomingActivity({ ...base, game: WOW, expires_at: NOW }, NOW)).toBeNull();
        expect(parseIncomingActivity({ ...base, game: WOW, expires_at: undefined }, NOW)).toBeNull();
        expect(parseIncomingActivity("playing", NOW)).toBeNull();
        // Whatever it says, a message is believed for twice the normal lifetime at most.
        expect(parseIncomingActivity({ ...base, game: WOW, expires_at: NOW + 365 * 86_400_000 }, NOW)).toMatchObject({
            expiresAt: NOW + 2 * ACTIVITY_LIFETIME_MS,
        });
    });

    it("take a start time in the future, from long ago or missing as just now", () => {
        const expires_at = NOW + 60_000;
        expect(parseIncomingActivity({ game: WOW, started_at: NOW + 60_000, expires_at }, NOW)).toMatchObject({ startedAt: NOW });
        expect(parseIncomingActivity({ game: WOW, started_at: NOW - 30 * 86_400_000, expires_at }, NOW)).toMatchObject({
            startedAt: NOW,
        });
        expect(parseIncomingActivity({ game: WOW, expires_at }, NOW)).toMatchObject({ startedAt: NOW });
    });

    it("make an id from a name, for a desktop app too old to send one", () => {
        expect(gameIdFromName("World of Warcraft")).toBe("world-of-warcraft");
        expect(gameIdFromName("Honkai: Star Rail")).toBe("honkai-star-rail");
        expect(gameIdFromName("!!!")).toBeNull();
    });

    it("carry a Steam game's icon as an encrypted file, rebuilt from just the parts that matter", () => {
        const sent = playingContent("DEV", { game: { ...WOW, icon: ICON }, music: null }, NOW, NOW);
        expect(sent.game).toEqual({ ...WOW, icon: ICON });
        expect(parseIncomingActivity(sent, NOW)).toMatchObject({ game: { ...WOW, icon: ICON } });
        expect(playingContent("DEV", { game: WOW, music: null }, NOW, NOW).game).toEqual(WOW);
        expect(
            cleanIcon({ ...ICON, mimetype: "image/svg+xml", key: { ...ICON.key, key_ops: ["sign"], extra: true } }),
        ).toEqual(ICON);
    });

    it("drop an icon that isn't a well-formed encrypted mxc file, but keep the game", () => {
        const malformed: unknown[] = [
            { ...ICON, url: "https://cdn.example/icon.jpg" },
            { ...ICON, url: "mxc://server/../../etc" },
            { ...ICON, v: "v1" },
            { ...ICON, key: { ...ICON.key, alg: "A128CTR" } },
            { ...ICON, key: { ...ICON.key, k: "short" } },
            { ...ICON, iv: "not base64!" },
            { ...ICON, hashes: {} },
            "mxc://matrix.jorvik.app/AbCdEf123",
        ];
        for (const icon of malformed) {
            expect(cleanGame({ ...WOW, icon })).toEqual(WOW);
        }
    });

    it("tell a game from the same game with its icon", () => {
        expect(sameGame(WOW, { ...WOW })).toBe(true);
        expect(sameGame(WOW, { ...WOW, icon: ICON })).toBe(false);
        expect(sameGame({ ...WOW, icon: ICON }, { ...WOW, icon: { ...ICON, iv: "d".repeat(22) } })).toBe(false);
        expect(sameGame(null, null)).toBe(true);
        expect(sameGame(WOW, null)).toBe(false);
    });

    it("only name a sending device that looks like one", () => {
        expect(contentDeviceId({ device_id: "ABCDEFG" })).toBe("ABCDEFG");
        expect(contentDeviceId({ device_id: "two words" })).toBeNull();
        expect(contentDeviceId(null)).toBeNull();
    });

    describe("with music", () => {
        const SONG = { player: { id: "spotify", name: "Spotify" }, title: "Song", artist: "Artist", album: "Album" };

        it("carry music on its own, or with a game, and read it back", () => {
            const alone = playingContent("DEV", { game: null, music: SONG }, NOW, NOW);
            expect(alone).toEqual({ device_id: "DEV", game: null, music: SONG, expires_at: NOW + ACTIVITY_LIFETIME_MS });
            expect(parseIncomingActivity(alone, NOW)).toEqual({
                game: null,
                music: SONG,
                startedAt: NOW,
                expiresAt: NOW + ACTIVITY_LIFETIME_MS,
            });
            const both = playingContent("DEV", { game: WOW, music: { ...SONG, cover: ICON } }, NOW - 1_000, NOW);
            expect(parseIncomingActivity(both, NOW)).toMatchObject({ game: WOW, music: { ...SONG, cover: ICON }, startedAt: NOW - 1_000 });
        });

        it("keep what matters and drop the rest; music without a title or player id doesn't count", () => {
            expect(cleanMusic({ ...SONG, artist: " ", extra: "x", cover: { url: "https://x" } })).toEqual({
                player: SONG.player,
                title: "Song",
                album: "Album",
            });
            expect(cleanMusic({ ...SONG, title: "" })).toBeNull();
            expect(cleanMusic({ ...SONG, player: { id: "Spotify!", name: "Spotify" } })).toBeNull();
            expect(cleanMusic({ ...SONG, player: { id: "spotify" } })).toBeNull();
            expect(cleanMusic("Song")).toBeNull();
        });

        it("treat a message with no game and broken music as stopped, and a broken game as nothing", () => {
            const base = { device_id: "DEV", expires_at: NOW + 60_000 };
            expect(parseIncomingActivity({ ...base, game: null, music: { title: "x" } }, NOW)).toEqual({
                game: null,
                music: null,
                stopped: true,
            });
            expect(parseIncomingActivity({ ...base, game: { id: "WoW!" }, music: SONG }, NOW)).toBeNull();
        });

        it("compare tracks by player, title, artist, album and cover", () => {
            expect(sameMusic(SONG, { ...SONG })).toBe(true);
            expect(sameMusic(SONG, { ...SONG, title: "Other" })).toBe(false);
            expect(sameMusic(SONG, { ...SONG, cover: ICON })).toBe(false);
            expect(sameMusic(null, undefined)).toBe(true);
        });
    });
});

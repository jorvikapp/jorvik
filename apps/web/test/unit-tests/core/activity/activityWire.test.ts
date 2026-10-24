// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
    ACTIVITY_LIFETIME_MS,
    cleanActivityText,
    contentDeviceId,
    gameIdFromName,
    parseIncomingActivity,
    playingContent,
    stoppedContent,
} from "../../../../src/core/activity/activityWire";

const NOW = 1_792_850_000_000;
const WOW = { id: "wow", name: "World of Warcraft" };

describe("activity messages", () => {
    it("say what's playing, since when, and until when to believe it", () => {
        expect(playingContent("DEV", WOW, NOW - 5_000, NOW)).toEqual({
            device_id: "DEV",
            game: WOW,
            started_at: NOW - 5_000,
            expires_at: NOW + ACTIVITY_LIFETIME_MS,
        });
        expect(stoppedContent("DEV")).toEqual({ device_id: "DEV", game: null });
    });

    it("read back what a sender sent", () => {
        expect(parseIncomingActivity(playingContent("DEV", WOW, NOW - 60_000, NOW), NOW + 1_000)).toEqual({
            game: WOW,
            startedAt: NOW - 60_000,
            expiresAt: NOW + ACTIVITY_LIFETIME_MS,
        });
        expect(parseIncomingActivity(stoppedContent("DEV"), NOW)).toEqual({ game: null });
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

    it("only name a sending device that looks like one", () => {
        expect(contentDeviceId({ device_id: "ABCDEFG" })).toBe("ABCDEFG");
        expect(contentDeviceId({ device_id: "two words" })).toBeNull();
        expect(contentDeviceId(null)).toBeNull();
    });
});

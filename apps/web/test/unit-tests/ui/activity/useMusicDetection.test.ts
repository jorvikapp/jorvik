import { describe, expect, it } from "vitest";

import { toDetectedMusic } from "../../../../src/ui/activity/useMusicDetection";

describe("toDetectedMusic", () => {
    it("takes the desktop app's track as music, cleaned", () => {
        expect(
            toDetectedMusic({ key: "k", player: { id: "spotify", name: "Spotify" }, title: " Song\n", artist: "Artist", album: null }),
        ).toEqual({ key: "k", music: { player: { id: "spotify", name: "Spotify" }, title: "Song", artist: "Artist" } });
    });

    it("refuses a track without a key, a title or a usable player", () => {
        const player = { id: "spotify", name: "Spotify" };
        expect(toDetectedMusic({ player, title: "Song" })).toBeNull();
        expect(toDetectedMusic({ key: "k", player, title: "" })).toBeNull();
        expect(toDetectedMusic({ key: "k", player: { id: "Spot ify", name: "x" }, title: "Song" })).toBeNull();
        expect(toDetectedMusic(null)).toBeNull();
    });
});

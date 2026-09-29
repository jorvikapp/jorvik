import { describe, expect, it } from "vitest";

import {
    MAX_GIF_FAVOURITES,
    normalizeGifFavourites,
    toggleGifFavourite,
    type GifItem,
} from "../../../../src/ui/components/composer/gifFavourites";

const gif = (n: number): GifItem => ({
    url: `https://static.klipy.com/${n}.gif`,
    previewUrl: `https://static.klipy.com/${n}.webp`,
    title: `GIF ${n}`,
});

describe("normalizeGifFavourites", () => {
    it("keeps well-formed entries and drops the rest", () => {
        expect(
            normalizeGifFavourites({
                gifs: [
                    gif(1),
                    { url: "http://insecure.example/2.gif", previewUrl: "https://x/2.webp", title: "no" },
                    { url: "javascript:alert(1)", title: "no" },
                    gif(1),
                    { url: "https://static.klipy.com/3.gif" },
                    "junk",
                ],
            }),
        ).toEqual([gif(1), { url: "https://static.klipy.com/3.gif", previewUrl: "https://static.klipy.com/3.gif", title: "GIF" }]);
    });

    it("treats missing or malformed content as no favourites", () => {
        expect(normalizeGifFavourites(undefined)).toEqual([]);
        expect(normalizeGifFavourites({ gifs: "nope" })).toEqual([]);
    });

    it("caps what it reads", () => {
        const many = Array.from({ length: MAX_GIF_FAVOURITES + 20 }, (_, n) => gif(n));
        expect(normalizeGifFavourites({ gifs: many })).toHaveLength(MAX_GIF_FAVOURITES);
    });
});

describe("toggleGifFavourite", () => {
    it("adds to the front and removes on a second toggle", () => {
        const once = toggleGifFavourite([gif(1)], gif(2));
        expect(once.map((g) => g.title)).toEqual(["GIF 2", "GIF 1"]);
        expect(toggleGifFavourite(once, gif(2))).toEqual([gif(1)]);
    });

    it("drops the oldest past the cap", () => {
        const full = Array.from({ length: MAX_GIF_FAVOURITES }, (_, n) => gif(n));
        const next = toggleGifFavourite(full, gif(999));
        expect(next).toHaveLength(MAX_GIF_FAVOURITES);
        expect(next[0]).toEqual(gif(999));
        expect(next.some((g) => g.url === gif(MAX_GIF_FAVOURITES - 1).url)).toBe(false);
    });
});

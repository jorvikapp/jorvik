import { useCallback, useEffect, useRef, useState } from "react";
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Favourite GIFs live in account data, so they follow the user to every
 * device. Newest first; capped so the event stays small.
 */
export const GIF_FAVOURITES_EVENT_TYPE = "com.heorot.gif_favourites";
export const MAX_GIF_FAVOURITES = 100;

export interface GifItem {
    url: string;
    previewUrl: string;
    title: string;
}

function isHttpsUrl(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("https://");
}

/** Account data is user-writable from any client, so trust none of it. */
export function normalizeGifFavourites(content: unknown): GifItem[] {
    const gifs = content && typeof content === "object" ? (content as { gifs?: unknown }).gifs : undefined;
    if (!Array.isArray(gifs)) {
        return [];
    }

    const seen = new Set<string>();
    const favourites: GifItem[] = [];
    for (const entry of gifs) {
        const candidate = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        if (!isHttpsUrl(candidate.url) || seen.has(candidate.url)) {
            continue;
        }
        seen.add(candidate.url);
        favourites.push({
            url: candidate.url,
            previewUrl: isHttpsUrl(candidate.previewUrl) ? candidate.previewUrl : candidate.url,
            title: typeof candidate.title === "string" ? candidate.title.slice(0, 200) : "GIF",
        });
        if (favourites.length >= MAX_GIF_FAVOURITES) {
            break;
        }
    }
    return favourites;
}

/** Adds the GIF to the front, or removes it if it is already a favourite. */
export function toggleGifFavourite(favourites: GifItem[], gif: GifItem): GifItem[] {
    if (favourites.some((favourite) => favourite.url === gif.url)) {
        return favourites.filter((favourite) => favourite.url !== gif.url);
    }
    return [gif, ...favourites].slice(0, MAX_GIF_FAVOURITES);
}

function readGifFavourites(client: MatrixClient): GifItem[] {
    return normalizeGifFavourites(client.getAccountData(GIF_FAVOURITES_EVENT_TYPE as any)?.getContent());
}

export interface GifFavouritesController {
    favourites: GifItem[];
    isFavourite: (url: string) => boolean;
    toggle: (gif: GifItem) => void;
    error: string | null;
}

export function useGifFavourites(client: MatrixClient): GifFavouritesController {
    const [favourites, setFavourites] = useState<GifItem[]>(() => readGifFavourites(client));
    const [error, setError] = useState<string | null>(null);
    // Toggles build on what is on screen, not on the last saved copy, so two
    // quick stars in a row keep both.
    const favouritesRef = useRef(favourites);
    const apply = useCallback((next: GifItem[]): void => {
        favouritesRef.current = next;
        setFavourites(next);
    }, []);

    // Another device, or this one, changed them.
    useEffect(() => {
        apply(readGifFavourites(client));
        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === GIF_FAVOURITES_EVENT_TYPE) {
                apply(normalizeGifFavourites(event.getContent()));
            }
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [apply, client]);

    const toggle = useCallback(
        (gif: GifItem): void => {
            const next = toggleGifFavourite(favouritesRef.current, gif);
            apply(next);
            setError(null);
            client.setAccountData(GIF_FAVOURITES_EVENT_TYPE as any, { gifs: next } as any).catch(() => {
                apply(readGifFavourites(client));
                setError("Could not save your favourites. Try again.");
            });
        },
        [apply, client],
    );

    const isFavourite = useCallback((url: string) => favourites.some((favourite) => favourite.url === url), [favourites]);

    return { favourites, isFavourite, toggle, error };
}

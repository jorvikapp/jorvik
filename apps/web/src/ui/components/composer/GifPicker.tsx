import React, { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { useGifFavourites, type GifItem } from "./gifFavourites";

const GIF_API = "https://matrix.jorvik.app/gif";
const TAB_STORAGE_KEY = "jorvik.gif_picker_tab";

type GifTab = "trending" | "favourites";

interface GifPickerProps { client: MatrixClient; onSelect: (url: string, title: string) => void; onClose: () => void; }

function readStoredTab(): GifTab {
    try {
        return window.localStorage.getItem(TAB_STORAGE_KEY) === "favourites" ? "favourites" : "trending";
    } catch {
        return "trending";
    }
}

// The relay spends our KLIPY quota on every GIF request, so it wants to know who asks.
function authHeaders(client: MatrixClient): Record<string, string> {
    const accessToken = client.getAccessToken();
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export function GifPicker({ client, onSelect, onClose }: GifPickerProps): React.ReactElement {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<GifItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<GifTab>(readStoredTab);
    const [trending, setTrending] = useState<GifItem[] | null>(null);
    const [trendingError, setTrendingError] = useState<string | null>(null);
    const favourites = useGifFavourites(client);

    useEffect(() => {
        const value = query.trim();
        if (!value) { setResults([]); setError(null); return; }
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true); setError(null);
            try {
                const response = await fetch(`${GIF_API}/search?q=${encodeURIComponent(value)}`, { signal: controller.signal, headers: authHeaders(client) });
                const payload = await response.json() as { results?: GifItem[]; error?: string };
                if (!response.ok) throw new Error(payload.error || "GIF search failed");
                setResults(Array.isArray(payload.results) ? payload.results : []);
            } catch (searchError) {
                if ((searchError as Error).name !== "AbortError") setError(searchError instanceof Error ? searchError.message : "GIF search failed");
            } finally { setLoading(false); }
        }, 300);
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [client, query]);

    // Fetched once per opening, the first time the Trending tab shows.
    useEffect(() => {
        if (tab !== "trending" || trending !== null) return;
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch(`${GIF_API}/trending`, { signal: controller.signal, headers: authHeaders(client) });
                const payload = await response.json() as { results?: GifItem[] };
                if (!response.ok) throw new Error("trending failed");
                setTrending(Array.isArray(payload.results) ? payload.results : []);
            } catch (trendingLoadError) {
                if ((trendingLoadError as Error).name !== "AbortError") setTrendingError("Could not load trending GIFs");
            }
        })();
        return () => controller.abort();
    }, [client, tab, trending]);

    const selectTab = (next: GifTab): void => {
        setTab(next);
        try { window.localStorage.setItem(TAB_STORAGE_KEY, next); } catch { /* the tab just is not remembered */ }
    };

    const searching = query.trim().length > 0;
    const shown = searching ? results : tab === "favourites" ? favourites.favourites : trending ?? [];
    let status: string | null = null;
    if (searching) {
        status = loading ? "Searching..." : error ?? (results.length === 0 ? "No GIFs found" : null);
    } else if (tab === "trending") {
        status = trendingError ?? (trending === null ? "Loading trending GIFs..." : null);
    } else if (favourites.favourites.length === 0) {
        status = "No favourites yet. Star a GIF to keep it here.";
    }

    return <div className="composer-gif-picker" role="dialog" aria-label="GIF picker">
        <div className="composer-emoji-picker-header">
            <input className="composer-emoji-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search KLIPY" autoFocus />
            <button type="button" className="composer-emoji-close" onClick={onClose} aria-label="Close GIF picker">x</button>
        </div>
        {!searching ? <div className="composer-gif-tabs" role="tablist" aria-label="GIFs">
            <button type="button" role="tab" aria-selected={tab === "trending"} className={`composer-gif-tab${tab === "trending" ? " is-active" : ""}`} onClick={() => selectTab("trending")}>Trending</button>
            <button type="button" role="tab" aria-selected={tab === "favourites"} className={`composer-gif-tab${tab === "favourites" ? " is-active" : ""}`} onClick={() => selectTab("favourites")}>
                Favourites{favourites.favourites.length > 0 ? ` (${favourites.favourites.length})` : ""}
            </button>
        </div> : null}
        <div className="composer-gif-scroll">
        {status ? <div className="composer-emoji-empty">{status}</div> : null}
        {favourites.error ? <div className="composer-emoji-empty">{favourites.error}</div> : null}
        <div className="composer-gif-grid">
            {shown.map((gif) => {
                const favourite = favourites.isFavourite(gif.url);
                return <div className="composer-gif-item" key={gif.url}>
                    <button type="button" className="composer-gif-send" onClick={() => onSelect(gif.url, gif.title)} title={gif.title}>
                        <img src={gif.previewUrl || gif.url} alt={gif.title} loading="lazy" decoding="async" />
                    </button>
                    <button
                        type="button"
                        className={`composer-gif-star${favourite ? " is-favourite" : ""}`}
                        aria-pressed={favourite}
                        aria-label={favourite ? "Remove from favourites" : "Add to favourites"}
                        title={favourite ? "Remove from favourites" : "Add to favourites"}
                        onClick={() => favourites.toggle(gif)}
                    >{favourite ? "★" : "☆"}</button>
                </div>;
            })}
        </div>
        </div>
        <div className="composer-gif-attribution">Powered by KLIPY</div>
    </div>;
}

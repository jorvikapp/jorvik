import React, { useEffect, useState } from "react";

interface GifPickerProps { onSelect: (url: string, title: string) => void; onClose: () => void; }
interface GifResult { url: string; previewUrl: string; title: string; }

export function GifPicker({ onSelect, onClose }: GifPickerProps): React.ReactElement {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<GifResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const value = query.trim();
        if (!value) { setResults([]); setError(null); return; }
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true); setError(null);
            try {
                const response = await fetch(`https://matrix.jorvik.app/gif/search?q=${encodeURIComponent(value)}`, { signal: controller.signal });
                const payload = await response.json() as { results?: GifResult[]; error?: string };
                if (!response.ok) throw new Error(payload.error || "GIF search failed");
                setResults(Array.isArray(payload.results) ? payload.results : []);
            } catch (searchError) {
                if ((searchError as Error).name !== "AbortError") setError(searchError instanceof Error ? searchError.message : "GIF search failed");
            } finally { setLoading(false); }
        }, 300);
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [query]);

    return <div className="composer-gif-picker" role="dialog" aria-label="GIF picker">
        <div className="composer-emoji-picker-header">
            <input className="composer-emoji-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search KLIPY" autoFocus />
            <button type="button" className="composer-emoji-close" onClick={onClose} aria-label="Close GIF picker">x</button>
        </div>
        {loading ? <div className="composer-emoji-empty">Searching...</div> : null}
        {error ? <div className="composer-emoji-empty">{error}</div> : null}
        {!loading && !error && query.trim() && results.length === 0 ? <div className="composer-emoji-empty">No GIFs found</div> : null}
        <div className="composer-gif-grid">
            {results.map((gif) => <button type="button" className="composer-gif-item" key={gif.url} onClick={() => onSelect(gif.url, gif.title)} title={gif.title}>
                <img src={gif.previewUrl || gif.url} alt={gif.title} loading="lazy" decoding="async" />
            </button>)}
        </div>
        <div className="composer-gif-attribution">Powered by KLIPY</div>
    </div>;
}

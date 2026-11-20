import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { fetchFromRelay } from "../voice/relayAuth";

/** Jorvik's relay asks Twitch, so people looking at a profile never talk to Twitch themselves. */
export const TWITCH_LIVE_API = "https://matrix.jorvik.app/twitch/live";

export interface TwitchStream {
    title: string;
    game: string | null;
    startedAt: string;
}

const LOGIN = /^[a-z0-9_]{1,25}$/;
/** twitch.tv pages that aren't channels. */
const NOT_CHANNELS = new Set(["directory", "videos", "settings", "subscriptions", "inventory", "wallet", "drops", "downloads", "jobs", "p", "search", "turbo", "friends", "messages"]);

/** The channel a Twitch link points to ("https://www.twitch.tv/Xuruh" -> "xuruh"); null for other links. */
export function twitchLoginOf(href: string): string | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
    if (host !== "twitch.tv") {
        return null;
    }
    const login = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    return LOGIN.test(login) && !NOT_CHANNELS.has(login) ? login : null;
}

// One answer per channel for a minute, shared by every profile that shows it; the relay caches too.
const FRESH_MS = 60_000;
const known = new Map<string, { stream: TwitchStream | null; at: number }>();
const pending = new Map<string, Promise<TwitchStream | null>>();

/** The channel's stream while it is live, null when it isn't; null too when it can't be checked. */
export function twitchStream(client: MatrixClient, login: string, now = Date.now()): Promise<TwitchStream | null> {
    const cached = known.get(login);
    if (cached && now - cached.at < FRESH_MS) {
        return Promise.resolve(cached.stream);
    }
    let request = pending.get(login);
    if (!request) {
        request = (async () => {
            try {
                const response = await fetchFromRelay(client, `${TWITCH_LIVE_API}?logins=${encodeURIComponent(login)}`);
                if (!response.ok) {
                    return cached?.stream ?? null;
                }
                const body = (await response.json()) as { live?: Record<string, unknown> };
                const stream = cleanStream(body.live?.[login]);
                known.set(login, { stream, at: Date.now() });
                return stream;
            } catch {
                return cached?.stream ?? null;
            } finally {
                pending.delete(login);
            }
        })();
        pending.set(login, request);
    }
    return request;
}

function cleanStream(value: unknown): TwitchStream | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const entry = value as Record<string, unknown>;
    return {
        title: typeof entry.title === "string" ? entry.title.slice(0, 140) : "",
        game: typeof entry.game === "string" && entry.game ? entry.game.slice(0, 100) : null,
        startedAt: typeof entry.startedAt === "string" ? entry.startedAt : "",
    };
}

/** For tests. */
export function clearTwitchStreams(): void {
    known.clear();
    pending.clear();
}

import type { SpaceHierarchyResult } from "./fetchSpaceHierarchy";

export const SPACE_HIERARCHY_CACHE_TTL_MS = 5 * 60 * 1000;
export const SPACE_HIERARCHY_CACHE_MAX_ENTRIES = 8;

/**
 * Why a token rather than a plain write: a fetch started before an invalidation must not
 * repopulate the cache afterwards. The token is registered when the fetch begins and
 * dropped by any invalidation touching its key, so a late write is refused.
 */
export interface HierarchyFetchToken {
    readonly key: string;
    readonly startedAt: number;
}

export type HierarchyCacheWriteResult =
    | "stored"
    | "rejected-incomplete"
    | "rejected-invalidated"
    | "rejected-stale";

interface CacheEntry {
    result: SpaceHierarchyResult;
    storedAt: number;
    fetchStartedAt: number;
}

function normalizeHomeserverForKey(raw: string | null | undefined): string {
    const trimmed = (raw ?? "").trim();
    if (trimmed.length === 0) {
        return "";
    }

    try {
        const parsed = new URL(trimmed);
        const isDefaultPort =
            (parsed.protocol === "https:" && parsed.port === "443") ||
            (parsed.protocol === "http:" && parsed.port === "80");
        const port = isDefaultPort ? "" : parsed.port;
        return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port.length > 0 ? `:${port}` : ""}`;
    } catch {
        return trimmed.toLowerCase().replace(/\/+$/, "");
    }
}

/**
 * Identifies the account a cached hierarchy belongs to. Returns null when there is no
 * user id: without one we cannot prove which account the data belongs to, so the caller
 * must not cache at all rather than risk sharing it.
 */
export function accountCacheKey(
    userId: string | null | undefined,
    homeserverUrl: string | null | undefined,
): string | null {
    const trimmedUserId = (userId ?? "").trim();
    if (trimmedUserId.length === 0) {
        return null;
    }

    return `${trimmedUserId}@${normalizeHomeserverForKey(homeserverUrl)}`;
}

interface SpaceHierarchyCacheOptions {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
}

export class SpaceHierarchyCache {
    private readonly ttlMs: number;
    private readonly maxEntries: number;
    private readonly now: () => number;
    /** Insertion order is LRU order: a read reinserts the key at the end. */
    private readonly entries = new Map<string, CacheEntry>();
    private readonly liveTokens = new Map<string, Set<HierarchyFetchToken>>();

    public constructor(options: SpaceHierarchyCacheOptions = {}) {
        this.ttlMs = options.ttlMs ?? SPACE_HIERARCHY_CACHE_TTL_MS;
        this.maxEntries = options.maxEntries ?? SPACE_HIERARCHY_CACHE_MAX_ENTRIES;
        this.now = options.now ?? (() => Date.now());
    }

    public get size(): number {
        return this.entries.size;
    }

    private static keyFor(accountKey: string, spaceRoomId: string): string {
        return `${accountKey}|${spaceRoomId}`;
    }

    public get(accountKey: string, spaceRoomId: string): SpaceHierarchyResult | null {
        const key = SpaceHierarchyCache.keyFor(accountKey, spaceRoomId);
        const entry = this.entries.get(key);
        if (!entry) {
            return null;
        }

        if (this.now() - entry.storedAt >= this.ttlMs) {
            this.entries.delete(key);
            return null;
        }

        // reinsert so this key becomes the most recently used
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.result;
    }

    public beginFetch(accountKey: string, spaceRoomId: string): HierarchyFetchToken {
        const key = SpaceHierarchyCache.keyFor(accountKey, spaceRoomId);
        const token: HierarchyFetchToken = { key, startedAt: this.now() };
        const tokens = this.liveTokens.get(key) ?? new Set<HierarchyFetchToken>();
        tokens.add(token);
        this.liveTokens.set(key, tokens);
        return token;
    }

    public set(token: HierarchyFetchToken, result: SpaceHierarchyResult): HierarchyCacheWriteResult {
        const tokens = this.liveTokens.get(token.key);
        const tokenIsLive = tokens?.delete(token) === true;
        if (tokens && tokens.size === 0) {
            this.liveTokens.delete(token.key);
        }

        if (!tokenIsLive) {
            return "rejected-invalidated";
        }

        // A truncated or partially failed hierarchy must never be served from cache as
        // though it were the whole space.
        if (!result.complete) {
            return "rejected-incomplete";
        }

        const existing = this.entries.get(token.key);
        if (existing && existing.fetchStartedAt >= token.startedAt) {
            return "rejected-stale";
        }

        this.entries.delete(token.key);
        this.entries.set(token.key, {
            result,
            storedAt: this.now(),
            fetchStartedAt: token.startedAt,
        });

        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next();
            if (oldest.done) {
                break;
            }
            this.entries.delete(oldest.value);
        }

        return "stored";
    }

    public invalidate(accountKey: string, spaceRoomId: string): void {
        const key = SpaceHierarchyCache.keyFor(accountKey, spaceRoomId);
        this.entries.delete(key);
        this.liveTokens.delete(key);
    }

    public invalidateAccount(accountKey: string): void {
        const prefix = `${accountKey}|`;
        for (const key of Array.from(this.entries.keys())) {
            if (key.startsWith(prefix)) {
                this.entries.delete(key);
            }
        }
        for (const key of Array.from(this.liveTokens.keys())) {
            if (key.startsWith(prefix)) {
                this.liveTokens.delete(key);
            }
        }
    }

    public clear(): void {
        this.entries.clear();
        this.liveTokens.clear();
    }
}

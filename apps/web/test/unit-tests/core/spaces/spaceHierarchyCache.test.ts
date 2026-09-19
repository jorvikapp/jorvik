import type { HierarchyRoom } from "matrix-js-sdk/src/matrix";
import { beforeEach, describe, expect, it } from "vitest";

import type { SpaceHierarchyResult } from "../../../../src/core/spaces/fetchSpaceHierarchy";
import {
    accountCacheKey,
    SPACE_HIERARCHY_CACHE_TTL_MS,
    SpaceHierarchyCache,
} from "../../../../src/core/spaces/spaceHierarchyCache";

const ACCOUNT = "@me:example.org@https://example.org";
const OTHER_ACCOUNT = "@other:example.org@https://example.org";
const SPACE = "!space:example.org";

function result(roomId: string, complete = true): SpaceHierarchyResult {
    return {
        rooms: [{ room_id: roomId } as HierarchyRoom],
        complete,
        pagesFetched: 1,
    };
}

describe("accountCacheKey", () => {
    it("refuses to produce a key without a user id, so the caller cannot cache", () => {
        expect(accountCacheKey(null, "https://example.org")).toBeNull();
        expect(accountCacheKey(undefined, "https://example.org")).toBeNull();
        expect(accountCacheKey("   ", "https://example.org")).toBeNull();
    });

    it("normalizes homeserver urls so equivalent spellings share one key", () => {
        const expected = accountCacheKey("@me:example.org", "https://Example.ORG");
        expect(accountCacheKey("@me:example.org", "https://example.org/")).toBe(expected);
        expect(accountCacheKey("@me:example.org", "https://example.org:443")).toBe(expected);
        expect(accountCacheKey("@me:example.org", "  https://example.org  ")).toBe(expected);
    });

    it("keeps different homeservers and users apart", () => {
        const a = accountCacheKey("@me:example.org", "https://example.org");
        expect(accountCacheKey("@me:example.org", "https://other.example")).not.toBe(a);
        expect(accountCacheKey("@you:example.org", "https://example.org")).not.toBe(a);
    });

    it("tolerates an unparseable homeserver url without throwing", () => {
        expect(accountCacheKey("@me:example.org", "not a url")).toBe("@me:example.org@not a url");
        expect(accountCacheKey("@me:example.org", null)).toBe("@me:example.org@");
    });
});

describe("SpaceHierarchyCache", () => {
    let clock: number;
    let cache: SpaceHierarchyCache;

    beforeEach(() => {
        clock = 1_000;
        cache = new SpaceHierarchyCache({ now: () => clock });
    });

    function store(accountKey: string, spaceId: string, value = result("!a:example.org")): string {
        const token = cache.beginFetch(accountKey, spaceId);
        return cache.set(token, value);
    }

    describe("hits and misses", () => {
        it("returns a stored result", () => {
            expect(store(ACCOUNT, SPACE)).toBe("stored");
            expect(cache.get(ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!a:example.org");
        });

        it("misses an unknown space", () => {
            expect(cache.get(ACCOUNT, "!nope:example.org")).toBeNull();
        });

        it("serves repeated reads without expiring them", () => {
            store(ACCOUNT, SPACE);
            expect(cache.get(ACCOUNT, SPACE)).not.toBeNull();
            expect(cache.get(ACCOUNT, SPACE)).not.toBeNull();
        });
    });

    describe("expiry", () => {
        it("still hits just before the ttl", () => {
            store(ACCOUNT, SPACE);
            clock += SPACE_HIERARCHY_CACHE_TTL_MS - 1;
            expect(cache.get(ACCOUNT, SPACE)).not.toBeNull();
        });

        it("misses at the ttl and drops the entry rather than hiding it", () => {
            store(ACCOUNT, SPACE);
            clock += SPACE_HIERARCHY_CACHE_TTL_MS;
            expect(cache.get(ACCOUNT, SPACE)).toBeNull();
            expect(cache.size).toBe(0);
        });
    });

    describe("invalidation", () => {
        it("removes only the named space", () => {
            store(ACCOUNT, SPACE);
            store(ACCOUNT, "!other:example.org", result("!b:example.org"));
            cache.invalidate(ACCOUNT, SPACE);
            expect(cache.get(ACCOUNT, SPACE)).toBeNull();
            expect(cache.get(ACCOUNT, "!other:example.org")).not.toBeNull();
        });

        it("removes only the named account", () => {
            store(ACCOUNT, SPACE);
            store(OTHER_ACCOUNT, SPACE, result("!b:example.org"));
            cache.invalidateAccount(ACCOUNT);
            expect(cache.get(ACCOUNT, SPACE)).toBeNull();
            expect(cache.get(OTHER_ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!b:example.org");
        });

        it("clears everything", () => {
            store(ACCOUNT, SPACE);
            store(OTHER_ACCOUNT, SPACE);
            cache.clear();
            expect(cache.size).toBe(0);
        });

        it("stops an in-flight fetch from repopulating after invalidation", () => {
            const token = cache.beginFetch(ACCOUNT, SPACE);
            cache.invalidate(ACCOUNT, SPACE);
            expect(cache.set(token, result("!late:example.org"))).toBe("rejected-invalidated");
            expect(cache.get(ACCOUNT, SPACE)).toBeNull();
        });

        it("stops an in-flight fetch from repopulating after the account is invalidated", () => {
            const token = cache.beginFetch(ACCOUNT, SPACE);
            cache.invalidateAccount(ACCOUNT);
            expect(cache.set(token, result("!late:example.org"))).toBe("rejected-invalidated");
        });

        it("stops an in-flight fetch from repopulating after a clear", () => {
            const token = cache.beginFetch(ACCOUNT, SPACE);
            cache.clear();
            expect(cache.set(token, result("!late:example.org"))).toBe("rejected-invalidated");
        });
    });

    describe("incomplete results", () => {
        it("refuses to cache a truncated hierarchy", () => {
            const token = cache.beginFetch(ACCOUNT, SPACE);
            expect(cache.set(token, result("!partial:example.org", false))).toBe("rejected-incomplete");
            expect(cache.get(ACCOUNT, SPACE)).toBeNull();
        });

        it("leaves an existing complete entry untouched when an incomplete one arrives", () => {
            store(ACCOUNT, SPACE, result("!good:example.org"));
            const token = cache.beginFetch(ACCOUNT, SPACE);
            expect(cache.set(token, result("!partial:example.org", false))).toBe("rejected-incomplete");
            expect(cache.get(ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!good:example.org");
        });
    });

    describe("stale responses", () => {
        it("refuses a write from a fetch older than the stored entry", () => {
            const early = cache.beginFetch(ACCOUNT, SPACE);
            clock += 10;
            const late = cache.beginFetch(ACCOUNT, SPACE);

            expect(cache.set(late, result("!newer:example.org"))).toBe("stored");
            expect(cache.set(early, result("!older:example.org"))).toBe("rejected-stale");
            expect(cache.get(ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!newer:example.org");
        });

        it("accepts a newer write over an older entry", () => {
            store(ACCOUNT, SPACE, result("!first:example.org"));
            clock += 10;
            expect(store(ACCOUNT, SPACE, result("!second:example.org"))).toBe("stored");
            expect(cache.get(ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!second:example.org");
        });
    });

    describe("navigation and isolation", () => {
        it("never serves one space's result for another", () => {
            store(ACCOUNT, SPACE);
            expect(cache.get(ACCOUNT, "!different:example.org")).toBeNull();
        });

        it("keeps the same room id apart across accounts, in both directions", () => {
            store(ACCOUNT, SPACE, result("!mine:example.org"));
            store(OTHER_ACCOUNT, SPACE, result("!theirs:example.org"));
            expect(cache.get(ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!mine:example.org");
            expect(cache.get(OTHER_ACCOUNT, SPACE)?.rooms[0].room_id).toBe("!theirs:example.org");
        });
    });

    describe("memory bound", () => {
        it("evicts the least recently used, not merely the oldest inserted", () => {
            const small = new SpaceHierarchyCache({ maxEntries: 2, now: () => clock });
            const put = (id: string): void => {
                small.set(small.beginFetch(ACCOUNT, id), result(`room-${id}`));
                clock += 1;
            };

            put("!one:example.org");
            put("!two:example.org");
            // touch the first so the second becomes least recently used
            expect(small.get(ACCOUNT, "!one:example.org")).not.toBeNull();
            put("!three:example.org");

            expect(small.size).toBe(2);
            expect(small.get(ACCOUNT, "!two:example.org")).toBeNull();
            expect(small.get(ACCOUNT, "!one:example.org")).not.toBeNull();
            expect(small.get(ACCOUNT, "!three:example.org")).not.toBeNull();
        });

        it("holds at most the configured number of entries", () => {
            for (let index = 0; index < 20; index++) {
                store(ACCOUNT, `!space${index}:example.org`);
                clock += 1;
            }
            expect(cache.size).toBe(8);
        });
    });
});

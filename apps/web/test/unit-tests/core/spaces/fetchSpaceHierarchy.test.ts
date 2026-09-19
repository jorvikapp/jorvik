import type { HierarchyRoom } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

import {
    fetchSpaceHierarchy,
    SpaceHierarchyAbortedError,
    SpaceHierarchyPageTimeoutError,
    type SpaceHierarchyPage,
} from "../../../../src/core/spaces/fetchSpaceHierarchy";
import { partitionSpaceChildren } from "../../../../src/core/spaces/spaceHierarchy";

function room(id: string, overrides: Partial<HierarchyRoom> = {}): HierarchyRoom {
    return {
        room_id: id,
        num_joined_members: 10,
        world_readable: true,
        guest_can_join: false,
        children_state: [],
        join_rule: "public",
        ...overrides,
    } as HierarchyRoom;
}

/**
 * Shaped like the real first page of #community:matrix.org: 50 rooms, of which 14 carry
 * room_type m.space -- the space itself plus 13 child subspaces, each with children of
 * its own.
 */
function matrixCommunityFirstPage(): SpaceHierarchyPage {
    const root = "!iMZEhwCvbfeAYUxAjZ:t2l.io";
    const subspaceNames = [
        "Advocacy", "Bots", "Chat Clients", "Bridges", "Servers/Hosting", "SDKs",
        "Clients", "Documentation", "Moderation", "Spec", "Translations", "Gaming", "Support",
    ];

    const rooms: HierarchyRoom[] = [
        room(root, {
            room_type: "m.space",
            name: "Matrix Community",
            children_state: subspaceNames.map((name, index) => ({
                type: "m.space.child",
                state_key: `!sub${index}:matrix.org`,
                sender: "@admin:matrix.org",
                origin_server_ts: 0,
                content: { via: ["matrix.org"] },
            })) as HierarchyRoom["children_state"],
        }),
    ];

    subspaceNames.forEach((name, index) => {
        rooms.push(
            room(`!sub${index}:matrix.org`, {
                room_type: "m.space",
                name,
                children_state: [
                    {
                        type: "m.space.child",
                        state_key: `!child${index}:matrix.org`,
                        sender: "@admin:matrix.org",
                        origin_server_ts: 0,
                        content: { via: ["matrix.org"] },
                    },
                ] as HierarchyRoom["children_state"],
            }),
        );
    });

    for (let index = rooms.length; index < 50; index++) {
        rooms.push(room(`!plain${index}:matrix.org`, { name: `Room ${index}` }));
    }

    return { rooms, nextBatch: "page2" };
}

describe("fetchSpaceHierarchy", () => {
    it("classifies a realistic Matrix Community page into 13 subspaces and 36 rooms", async () => {
        const page = matrixCommunityFirstPage();
        expect(page.rooms).toHaveLength(50);
        expect(page.rooms.filter((entry) => entry.room_type === "m.space")).toHaveLength(14);

        const result = await fetchSpaceHierarchy({
            fetchPage: async () => ({ rooms: page.rooms }),
        });

        const children = partitionSpaceChildren("!iMZEhwCvbfeAYUxAjZ:t2l.io", result.rooms);
        expect(children.spaces).toHaveLength(13);
        expect(children.rooms).toHaveLength(36);
        expect(children.spaces.map((entry) => entry.name)).toContain("Bridges");
    });

    it("accumulates every page and dedupes by room id", async () => {
        const pages: SpaceHierarchyPage[] = [
            { rooms: [room("!a:x"), room("!b:x")], nextBatch: "t1" },
            { rooms: [room("!b:x"), room("!c:x")], nextBatch: "t2" },
            { rooms: [room("!d:x")] },
        ];
        let call = 0;
        const result = await fetchSpaceHierarchy({ fetchPage: async () => pages[call++] });

        expect(result.rooms.map((entry) => entry.room_id)).toEqual(["!a:x", "!b:x", "!c:x", "!d:x"]);
        expect(result.complete).toBe(true);
        expect(result.pagesFetched).toBe(3);
    });

    it("survives three slow pages that would together exceed a whole-fetch budget", async () => {
        // Each page takes 15s of virtual time; 45s total would blow a 20s budget for
        // the whole loop, which is exactly the regression this guards.
        const perPageMs = 15_000;
        let now = 0;
        const pages: SpaceHierarchyPage[] = [
            { rooms: [room("!a:x")], nextBatch: "t1" },
            { rooms: [room("!b:x")], nextBatch: "t2" },
            { rooms: [room("!c:x")] },
        ];
        let call = 0;

        const result = await fetchSpaceHierarchy({
            pageTimeoutMs: 20_000,
            // the timer never fires, because every page resolves inside its own budget
            schedule: () => () => undefined,
            fetchPage: async () => {
                now += perPageMs;
                return pages[call++];
            },
        });

        expect(now).toBe(45_000);
        expect(result.rooms).toHaveLength(3);
        expect(result.complete).toBe(true);
    });

    it("rejects, and aborts the request, when a page never answers", async () => {
        let observedSignal: AbortSignal | undefined;
        const failure = fetchSpaceHierarchy({
            pageTimeoutMs: 1,
            schedule: (callback) => {
                callback();
                return () => undefined;
            },
            fetchPage: (_token, signal) =>
                new Promise<SpaceHierarchyPage>(() => {
                    observedSignal = signal;
                }),
        });

        await expect(failure).rejects.toBeInstanceOf(SpaceHierarchyPageTimeoutError);
        expect(observedSignal?.aborted).toBe(true);
    });

    it("reports an incomplete result at the page cap instead of pretending it is whole", async () => {
        const result = await fetchSpaceHierarchy({
            maxPages: 2,
            fetchPage: async (token) => ({
                rooms: [room(`!page${token ?? "0"}:x`)],
                nextBatch: `after-${token ?? "0"}`,
            }),
        });

        expect(result.pagesFetched).toBe(2);
        expect(result.complete).toBe(false);
        expect(result.rooms).toHaveLength(2);
    });

    it("does not return partial rooms when a later page fails", async () => {
        let call = 0;
        const failure = fetchSpaceHierarchy({
            fetchPage: async () => {
                call += 1;
                if (call === 1) {
                    return { rooms: [room("!first:x")], nextBatch: "t1" };
                }
                throw new Error("page 2 exploded");
            },
        });

        await expect(failure).rejects.toThrow("page 2 exploded");
        expect(call).toBe(2);
    });

    it("aborts the in-flight request and rejects when the caller navigates away", async () => {
        const controller = new AbortController();
        const seen: AbortSignal[] = [];

        // a fetcher that ignores the signal entirely: the loop must still give up,
        // rather than waiting out the page budget
        const failure = fetchSpaceHierarchy({
            signal: controller.signal,
            fetchPage: (_token, signal) => {
                seen.push(signal);
                controller.abort();
                return new Promise<SpaceHierarchyPage>(() => undefined);
            },
        });

        await expect(failure).rejects.toBeInstanceOf(SpaceHierarchyAbortedError);
        expect(seen[0]?.aborted).toBe(true);
    });

    it("throws immediately if the caller already navigated away", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchPage = vi.fn();

        await expect(fetchSpaceHierarchy({ signal: controller.signal, fetchPage })).rejects.toBeInstanceOf(
            SpaceHierarchyAbortedError,
        );
        expect(fetchPage).not.toHaveBeenCalled();
    });
});

import type { HierarchyRoom } from "matrix-js-sdk/src/matrix";

/**
 * Per page, not per fetch. A space with several pages legitimately takes far longer
 * than any single page, and budgeting the whole loop broke large healthy spaces.
 * Generous, because an observed page took 19.5s; it exists to catch a request that
 * never answers at all, which is what a partial-state room does.
 */
export const SPACE_HIERARCHY_PAGE_TIMEOUT_MS = 45_000;
export const SPACE_HIERARCHY_MAX_PAGES = 20;

export class SpaceHierarchyPageTimeoutError extends Error {
    public readonly pageNumber: number;

    public constructor(pageNumber: number) {
        super(`Timed out fetching space hierarchy page ${pageNumber}`);
        this.pageNumber = pageNumber;
    }
}

export class SpaceHierarchyAbortedError extends Error {
    public constructor() {
        super("Space hierarchy fetch was abandoned");
    }
}

export interface SpaceHierarchyPage {
    rooms: HierarchyRoom[];
    nextBatch?: string;
}

export interface SpaceHierarchyResult {
    rooms: HierarchyRoom[];
    /** False when the page cap stopped us while more pages were still offered. */
    complete: boolean;
    pagesFetched: number;
}

export interface FetchSpaceHierarchyOptions {
    /** Given a pagination token, fetch one page. The signal aborts the request itself. */
    fetchPage: (fromToken: string | undefined, signal: AbortSignal) => Promise<SpaceHierarchyPage>;
    pageTimeoutMs?: number;
    maxPages?: number;
    /** Aborted when the caller stops caring, e.g. the user selects a different space. */
    signal?: AbortSignal;
    /** Injected so tests need no real timers. Returns a cancel function. */
    schedule?: (callback: () => void, ms: number) => () => void;
}

function defaultSchedule(callback: () => void, ms: number): () => void {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
}

/**
 * Walks a space's hierarchy pages, accumulating rooms.
 *
 * A page that times out or fails rejects the whole call rather than returning what
 * arrived so far: a partial hierarchy presented as complete is worse than an error,
 * because the caller cannot tell it is missing rooms. The one exception is the page
 * cap, which returns `complete: false` so the caller can say so explicitly.
 */
export async function fetchSpaceHierarchy(options: FetchSpaceHierarchyOptions): Promise<SpaceHierarchyResult> {
    const pageTimeoutMs = options.pageTimeoutMs ?? SPACE_HIERARCHY_PAGE_TIMEOUT_MS;
    const maxPages = options.maxPages ?? SPACE_HIERARCHY_MAX_PAGES;
    const schedule = options.schedule ?? defaultSchedule;

    const roomById = new Map<string, HierarchyRoom>();
    const visitedTokens = new Set<string>();
    let fromToken: string | undefined;
    let pagesFetched = 0;

    for (;;) {
        if (options.signal?.aborted) {
            throw new SpaceHierarchyAbortedError();
        }

        const controller = new AbortController();
        let cancelTimer: () => void = () => undefined;
        let onOuterAbort: (() => void) | undefined;

        try {
            const page = await new Promise<SpaceHierarchyPage>((resolve, reject) => {
                cancelTimer = schedule(() => {
                    // Cancel the request, not merely our wait for it, so a hung
                    // request does not keep a connection open behind us.
                    controller.abort();
                    reject(new SpaceHierarchyPageTimeoutError(pagesFetched + 1));
                }, pageTimeoutMs);

                // Reject on outer abort as well as cancelling the request. Waiting for
                // the fetcher to notice the signal would leave us pending for the whole
                // page budget if it does not honour it.
                onOuterAbort = () => {
                    controller.abort();
                    reject(new SpaceHierarchyAbortedError());
                };
                if (options.signal) {
                    options.signal.addEventListener("abort", onOuterAbort, { once: true });
                }

                options.fetchPage(fromToken, controller.signal).then(resolve, reject);
            });

            pagesFetched += 1;
            for (const room of page.rooms) {
                if (!roomById.has(room.room_id)) {
                    roomById.set(room.room_id, room);
                }
            }

            const nextBatch = page.nextBatch;
            if (!nextBatch || visitedTokens.has(nextBatch)) {
                return { rooms: Array.from(roomById.values()), complete: true, pagesFetched };
            }

            if (pagesFetched >= maxPages) {
                return { rooms: Array.from(roomById.values()), complete: false, pagesFetched };
            }

            visitedTokens.add(nextBatch);
            fromToken = nextBatch;
        } finally {
            cancelTimer();
            if (onOuterAbort) {
                options.signal?.removeEventListener("abort", onOuterAbort);
            }
        }
    }
}

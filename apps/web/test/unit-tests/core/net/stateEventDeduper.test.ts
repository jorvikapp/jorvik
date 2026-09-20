import { describe, expect, it, vi } from "vitest";

import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    createStateEventDeduper,
    sharedStateEventDeduperFor,
} from "../../../../src/core/net/stateEventDeduper";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("createStateEventDeduper", () => {
    it("serves simultaneous callers from one request", async () => {
        const pending = deferred<unknown>();
        const request = vi.fn(() => pending.promise);
        const deduper = createStateEventDeduper(request);

        const first = deduper.get("!room:x", "com.example.type", "");
        const second = deduper.get("!room:x", "com.example.type", "");

        expect(request).toHaveBeenCalledTimes(1);
        expect(deduper.inFlightCount).toBe(1);

        pending.resolve({ ok: true });
        await expect(first).resolves.toEqual({ ok: true });
        await expect(second).resolves.toEqual({ ok: true });
    });

    it("keeps different rooms, types and state keys apart", async () => {
        const request = vi.fn(async (roomId: string, type: string, key: string) => `${roomId}|${type}|${key}`);
        const deduper = createStateEventDeduper(request);

        await Promise.all([
            deduper.get("!a:x", "t", ""),
            deduper.get("!b:x", "t", ""),
            deduper.get("!a:x", "other", ""),
            deduper.get("!a:x", "t", "key"),
        ]);

        expect(request).toHaveBeenCalledTimes(4);
    });

    it("issues a fresh request once the previous one settled, rather than caching", async () => {
        const request = vi.fn(async () => ({ value: 1 }));
        const deduper = createStateEventDeduper(request);

        await deduper.get("!room:x", "t", "");
        expect(deduper.inFlightCount).toBe(0);
        await deduper.get("!room:x", "t", "");

        expect(request).toHaveBeenCalledTimes(2);
    });

    it("propagates a failure to every waiting caller", async () => {
        const pending = deferred<unknown>();
        const request = vi.fn(() => pending.promise);
        const deduper = createStateEventDeduper(request);

        const first = deduper.get("!room:x", "t", "");
        const second = deduper.get("!room:x", "t", "");
        pending.reject(new Error("no"));

        await expect(first).rejects.toThrow("no");
        await expect(second).rejects.toThrow("no");
    });

    it("allows a retry after a failure instead of caching the error", async () => {
        let attempt = 0;
        const request = vi.fn(async () => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error("transient");
            }
            return { ok: true };
        });
        const deduper = createStateEventDeduper(request);

        await expect(deduper.get("!room:x", "t", "")).rejects.toThrow("transient");
        expect(deduper.inFlightCount).toBe(0);
        await expect(deduper.get("!room:x", "t", "")).resolves.toEqual({ ok: true });
        expect(request).toHaveBeenCalledTimes(2);
    });
});

describe("sharedStateEventDeduperFor", () => {
    function fakeClient(): MatrixClient {
        return { getStateEvent: vi.fn(async () => ({ ok: true })) } as unknown as MatrixClient;
    }

    it("returns the same instance for one client, so separate callers share requests", () => {
        const client = fakeClient();
        expect(sharedStateEventDeduperFor(client)).toBe(sharedStateEventDeduperFor(client));
    });

    it("keeps separate clients apart, so a new session never reuses the old one", () => {
        expect(sharedStateEventDeduperFor(fakeClient())).not.toBe(sharedStateEventDeduperFor(fakeClient()));
    });

    it("routes requests through the client it was created for", async () => {
        const client = fakeClient();
        await sharedStateEventDeduperFor(client).get("!room:x", "com.example.type", "");
        expect(client.getStateEvent).toHaveBeenCalledWith("!room:x", "com.example.type", "");
    });

    it("drops a failed request so the next caller retries against the same client", async () => {
        const failing = { getStateEvent: vi.fn() } as unknown as MatrixClient;
        (failing.getStateEvent as unknown as ReturnType<typeof vi.fn>)
            .mockRejectedValueOnce(new Error("transient"))
            .mockResolvedValueOnce({ ok: true });

        const deduper = sharedStateEventDeduperFor(failing);
        await expect(deduper.get("!room:x", "t", "")).rejects.toThrow("transient");
        expect(deduper.inFlightCount).toBe(0);
        await expect(deduper.get("!room:x", "t", "")).resolves.toEqual({ ok: true });
    });
});

import { describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    ON_PHONE_FIELD,
    ON_PHONE_FRESH_MS,
    OnPhoneStore,
    onPhoneFrom,
    startOnPhoneWriter,
} from "../../../../src/core/presence/onPhone";

const notFound = Object.assign(new Error("not found"), { httpStatus: 404, errcode: "M_NOT_FOUND" });
const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

function fakeClient(fields: Record<string, Record<string, unknown>> = {}, me = "@me:test") {
    const get = vi.fn(async (userId: string, key: string) => {
        const value = fields[userId]?.[key];
        if (value === undefined) throw notFound;
        return value;
    });
    const set = vi.fn(async (key: string, value: unknown) => {
        (fields[me] ??= {})[key] = value;
    });
    const del = vi.fn(async (key: string) => {
        delete fields[me]?.[key];
    });
    const authedRequest = vi.fn(async (_method: string, path: string) => {
        const [, user, key] = /^\/profile\/([^/]+)\/([^/]+)$/.exec(path)!;
        return { [decodeURIComponent(key!)]: await get(decodeURIComponent(user!), decodeURIComponent(key!)) };
    });
    const client = {
        getUserId: () => me,
        http: { authedRequest },
        doesServerSupportExtendedProfiles: vi.fn(async () => true),
        getExtendedProfileProperty: get,
        setExtendedProfileProperty: set,
        deleteExtendedProfileProperty: del,
    } as unknown as MatrixClient;
    return { client, get, set, del, fields };
}

describe("onPhoneFrom", () => {
    it("is yes only for true (or 1, as SQLite returns it)", () => {
        expect(onPhoneFrom(true)).toBe(true);
        expect(onPhoneFrom("true")).toBe(false);
        expect(onPhoneFrom(1)).toBe(true);
        expect(onPhoneFrom(0)).toBe(false);
        expect(onPhoneFrom(undefined)).toBe(false);
    });
});

describe("OnPhoneStore", () => {
    it("fetches a watched person and tells listeners", async () => {
        const { client } = fakeClient({ "@a:test": { [ON_PHONE_FIELD]: true } });
        const store = new OnPhoneStore(client);
        const listener = vi.fn();
        store.subscribe(listener);
        expect(store.isOnPhone("@a:test")).toBe(false);
        store.watch("@a:test");
        await flush();
        expect(store.isOnPhone("@a:test")).toBe(true);
        expect(listener).toHaveBeenCalled();
        store.stop();
    });

    it("takes a missing field as not on a phone", async () => {
        const { client } = fakeClient();
        const store = new OnPhoneStore(client);
        store.watch("@b:test");
        await flush();
        expect(store.isOnPhone("@b:test")).toBe(false);
        store.stop();
    });

    it("doesn't fetch again while fresh, but does after a presence change", async () => {
        let t = 1_000_000;
        const { client, get, fields } = fakeClient({ "@a:test": {} });
        const store = new OnPhoneStore(client, () => t);
        store.watch("@a:test");
        await flush();
        store.watch("@a:test");
        await flush();
        expect(get).toHaveBeenCalledTimes(1);
        fields["@a:test"]![ON_PHONE_FIELD] = true;
        store.invalidate("@a:test");
        await flush();
        expect(get).toHaveBeenCalledTimes(2);
        expect(store.isOnPhone("@a:test")).toBe(true);
        t += ON_PHONE_FRESH_MS + 1;
        store.watch("@a:test");
        await flush();
        expect(get).toHaveBeenCalledTimes(3);
        store.stop();
    });

    it("asks nothing on a server without extended profiles", async () => {
        const { client, get } = fakeClient();
        (client.doesServerSupportExtendedProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        const store = new OnPhoneStore(client);
        store.watch("@a:test");
        await flush();
        expect(get).not.toHaveBeenCalled();
        store.stop();
    });

    it("keeps the last answer when the server can't be asked", async () => {
        let t = 0;
        const { client, get } = fakeClient({ "@a:test": { [ON_PHONE_FIELD]: true } });
        const store = new OnPhoneStore(client, () => t);
        store.watch("@a:test");
        await flush();
        get.mockRejectedValueOnce(Object.assign(new Error("down"), { httpStatus: 502 }));
        t += ON_PHONE_FRESH_MS + 1;
        store.watch("@a:test");
        await flush();
        expect(store.isOnPhone("@a:test")).toBe(true);
        store.stop();
    });
});

describe("startOnPhoneWriter", () => {
    it("a phone sets the field once, and not again while it already says so", async () => {
        let t = 0;
        const { client, set, fields } = fakeClient();
        const stop = startOnPhoneWriter(client, null, { isPhone: () => true, now: () => t });
        await flush();
        expect(set).toHaveBeenCalledWith(ON_PHONE_FIELD, true);
        expect(fields["@me:test"]![ON_PHONE_FIELD]).toBe(true);
        t += 61_000;
        window.dispatchEvent(new Event("pointerdown"));
        await flush();
        expect(set).toHaveBeenCalledTimes(1);
        stop();
    });

    it("a computer removes it, and only when it's set", async () => {
        const { client, del } = fakeClient({ "@me:test": { [ON_PHONE_FIELD]: true } });
        const stop = startOnPhoneWriter(client, null, { isPhone: () => false });
        await flush();
        expect(del).toHaveBeenCalledWith(ON_PHONE_FIELD);
        stop();

        const other = fakeClient();
        const stop2 = startOnPhoneWriter(other.client, null, { isPhone: () => false });
        await flush();
        expect(other.del).not.toHaveBeenCalled();
        stop2();
    });

    it("writes at most once a minute however much the app is used", async () => {
        let t = 0;
        const { client, get } = fakeClient();
        const stop = startOnPhoneWriter(client, null, { isPhone: () => false, now: () => t });
        await flush();
        for (let i = 0; i < 5; i++) {
            t += 1000;
            window.dispatchEvent(new Event("keydown"));
        }
        await flush();
        expect(get).toHaveBeenCalledTimes(1);
        stop();
    });

    it("updates its own avatar at once", async () => {
        const { client } = fakeClient();
        const store = new OnPhoneStore(client);
        const stop = startOnPhoneWriter(client, store, { isPhone: () => true });
        await flush();
        expect(store.isOnPhone("@me:test")).toBe(true);
        stop();
        store.stop();
    });
});

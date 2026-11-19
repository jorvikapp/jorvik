import { describe, expect, it, vi } from "vitest";

import {
    LegacyTokenKeeper,
    REFRESH_AHEAD_MS,
    type RefreshedTokens,
} from "../../../../src/core/client/legacyTokenRefresh";

const URL = "https://matrix.example/_matrix/client/v3/sync";

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const expired = () => json(401, { errcode: "M_UNKNOWN_TOKEN", error: "Access token has expired", soft_logout: true });

function authOf(init?: RequestInit): string | null {
    return new Headers(init?.headers).get("Authorization");
}

/** A homeserver that accepts only `valid` and answers everything else with an expired-token 401. */
function server(valid: { token: string }) {
    return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        authOf(init) === `Bearer ${valid.token}` ? json(200, { ok: true }) : expired(),
    );
}

function setup(opts: { refresh?: (rt: string) => Promise<RefreshedTokens>; now?: () => number } = {}) {
    const valid = { token: "new-1" };
    const baseFetch = server(valid);
    let n = 0;
    const refresh = vi.fn(
        opts.refresh ??
            (async (rt: string) => {
                n += 1;
                valid.token = `new-${n}`;
                return { accessToken: `new-${n}`, refreshToken: `rt-${n}-from-${rt}` };
            }),
    );
    const onRefreshed = vi.fn();
    const keeper = new LegacyTokenKeeper({
        accessToken: "old",
        refreshToken: "rt-0",
        refresh,
        onRefreshed,
        baseFetch,
        now: opts.now,
    });
    const get = (token = keeper.currentAccessToken) => keeper.fetch(URL, { headers: { Authorization: `Bearer ${token}` } });
    return { keeper, baseFetch, refresh, onRefreshed, valid, get };
}

describe("LegacyTokenKeeper", () => {
    it("passes successful responses through without refreshing", async () => {
        const { keeper, baseFetch, refresh, valid } = setup();
        valid.token = "old";
        const response = await keeper.fetch(URL, { headers: { Authorization: "Bearer old" } });
        expect(response.status).toBe(200);
        expect(refresh).not.toHaveBeenCalled();
        expect(baseFetch).toHaveBeenCalledTimes(1);
    });

    it("refreshes on an expired token and sends the request again with the new one", async () => {
        const { keeper, baseFetch, refresh, onRefreshed, get } = setup();
        const response = await get();
        expect(response.status).toBe(200);
        expect(refresh).toHaveBeenCalledWith("rt-0");
        expect(onRefreshed).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "new-1" }));
        expect(keeper.currentAccessToken).toBe("new-1");
        expect(authOf(baseFetch.mock.calls[1][1])).toBe("Bearer new-1");
    });

    it("shares one refresh between requests that expire together (refresh tokens are single-use)", async () => {
        const { refresh, get } = setup();
        const responses = await Promise.all([get(), get(), get()]);
        expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("retries a request sent with an already-replaced token without refreshing again", async () => {
        const { keeper, refresh, get } = setup();
        await get();
        const late = await keeper.fetch(URL, { headers: { Authorization: "Bearer old" } });
        expect(late.status).toBe(200);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("uses each new refresh token for the next refresh", async () => {
        const { keeper, refresh, valid, get } = setup();
        await get();
        valid.token = "expired-again";
        await keeper.fetch(URL, { headers: { Authorization: `Bearer ${keeper.currentAccessToken}` } });
        expect(refresh.mock.calls.map((c) => c[0])).toEqual(["rt-0", "rt-1-from-rt-0"]);
    });

    it("hands the 401 back when the refresh fails, and can try again later", async () => {
        let fail = true;
        const { refresh, onRefreshed, get } = setup({
            refresh: async () => {
                if (fail) throw new Error("refresh token gone");
                return { accessToken: "new-1" };
            },
        });
        const first = await get();
        expect(first.status).toBe(401);
        expect(onRefreshed).not.toHaveBeenCalled();
        fail = false;
        expect((await get()).status).toBe(200);
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("sends the request again only once", async () => {
        const { keeper, baseFetch, refresh } = setup({ refresh: async () => ({ accessToken: "also-rejected" }) });
        const response = await keeper.fetch(URL, { headers: { Authorization: "Bearer old" } });
        expect(response.status).toBe(401);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(baseFetch).toHaveBeenCalledTimes(2);
    });

    it("leaves other errors and requests without a token alone", async () => {
        const { keeper, refresh } = setup();
        const forbidden = vi.fn(async () => json(403, { errcode: "M_FORBIDDEN" }));
        const other = new LegacyTokenKeeper({
            accessToken: "old",
            refreshToken: "rt-0",
            refresh,
            onRefreshed: vi.fn(),
            baseFetch: forbidden,
        });
        expect((await other.fetch(URL, { headers: { Authorization: "Bearer old" } })).status).toBe(403);
        expect((await keeper.fetch(URL)).status).toBe(401);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("doesn't treat a short-lived token as expiring from the moment it is issued", async () => {
        let now = 1_000_000;
        let n = 0;
        const { keeper, refresh, valid } = setup({
            now: () => now,
            refresh: async () => {
                n += 1;
                valid.token = `new-${n}`;
                return { accessToken: `new-${n}`, expiry: new Date(now + 60_000) }; // one-minute tokens
            },
        });
        await keeper.fetch(URL, { headers: { Authorization: "Bearer old" } });
        const send = () => keeper.fetch(URL, { headers: { Authorization: `Bearer ${keeper.currentAccessToken}` } });
        now += 30_000;
        await send(); // half-way: no refresh
        expect(refresh).toHaveBeenCalledTimes(1);
        now += 20_000; // 50 s into a 60 s token: within its last quarter
        await send();
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("refreshes before sending once a known expiry is less than a minute away", async () => {
        let now = 1_000_000;
        let n = 0;
        const { keeper, baseFetch, refresh, valid } = setup({
            now: () => now,
            refresh: async () => {
                n += 1;
                valid.token = `new-${n}`;
                return { accessToken: `new-${n}`, expiry: new Date(now + 5 * 60_000) };
            },
        });
        await keeper.fetch(URL, { headers: { Authorization: "Bearer old" } }); // first refresh learns the expiry
        baseFetch.mockClear();
        now += 5 * 60_000 - REFRESH_AHEAD_MS + 1;
        const response = await keeper.fetch(URL, { headers: { Authorization: `Bearer ${keeper.currentAccessToken}` } });
        expect(response.status).toBe(200);
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(baseFetch).toHaveBeenCalledTimes(1); // went out with the fresh token straight away
        expect(authOf(baseFetch.mock.calls[0][1])).toBe("Bearer new-2");
    });
});

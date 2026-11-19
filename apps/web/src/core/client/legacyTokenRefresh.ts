import { logger } from "matrix-js-sdk/src/logger";

/**
 * Keeps a session with Synapse's own refresh tokens alive (we sign in with `refresh_token: true`, so access
 * tokens last about five minutes).
 *
 * matrix-js-sdk 43 and later only refresh OAuth2-native sessions themselves: with a plain refresh token the SDK
 * treats an expired access token (401 M_UNKNOWN_TOKEN) as a logout. So Jorvik hands the SDK this `fetch`:
 *  - a request sent in the last minute of a token's known lifetime refreshes first, which keeps uploads (sent by
 *    the SDK with XMLHttpRequest, not through here) on a fresh token too;
 *  - a request that still comes back 401 M_UNKNOWN_TOKEN refreshes and is sent again, once.
 * There is only ever one refresh at a time: refresh tokens are single-use, so requests that fail together share
 * it, and a request that went out with a token that has since been replaced just retries with the new one.
 * When the refresh itself fails, the original 401 goes back to the SDK, which signs out as it always did.
 */

export interface RefreshedTokens {
    accessToken: string;
    refreshToken?: string;
    expiry?: Date;
}

/** Swaps a refresh token for new tokens (Synapse's POST /refresh). */
export type LegacyTokenRefreshFunction = (refreshToken: string) => Promise<RefreshedTokens>;

export interface LegacyTokenKeeperOpts {
    accessToken: string;
    refreshToken: string;
    refresh: LegacyTokenRefreshFunction;
    /** Called after each successful refresh, e.g. to give the client the new access token. */
    onRefreshed: (tokens: RefreshedTokens) => void;
    baseFetch?: typeof fetch;
    now?: () => number;
}

/** Refresh this long before a token's known expiry (or within its last quarter, if that is shorter). */
export const REFRESH_AHEAD_MS = 60_000;

function bearerOf(input: RequestInfo | URL, init?: RequestInit): string | undefined {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const match = /^Bearer (.+)$/.exec(headers.get("Authorization") ?? "");
    return match?.[1];
}

function withBearer(input: RequestInfo | URL, init: RequestInit | undefined, token: string): RequestInit {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
}

export class LegacyTokenKeeper {
    private accessToken: string;
    private refreshToken: string;
    private refreshAt?: number;
    private inFlight?: Promise<string | null>;

    public constructor(private readonly opts: LegacyTokenKeeperOpts) {
        this.accessToken = opts.accessToken;
        this.refreshToken = opts.refreshToken;
    }

    public get currentAccessToken(): string {
        return this.accessToken;
    }

    /**
     * The token to use instead of `staleToken`: refreshes unless that already happened since `staleToken` was
     * current. Resolves to null when the refresh fails.
     */
    public refreshFrom(staleToken: string): Promise<string | null> {
        if (staleToken !== this.accessToken) return Promise.resolve(this.accessToken);
        this.inFlight ??= this.doRefresh().finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }

    private async doRefresh(): Promise<string | null> {
        try {
            const tokens = await this.opts.refresh(this.refreshToken);
            this.accessToken = tokens.accessToken;
            if (tokens.refreshToken) this.refreshToken = tokens.refreshToken;
            // Refresh in the last minute, or the last quarter for short-lived tokens, so a one-minute token
            // doesn't count as "about to expire" from the moment it is issued.
            const now = (this.opts.now ?? Date.now)();
            const expiresAt = tokens.expiry?.getTime();
            this.refreshAt =
                expiresAt === undefined ? undefined : expiresAt - Math.min(REFRESH_AHEAD_MS, (expiresAt - now) / 4);
            this.opts.onRefreshed(tokens);
            return tokens.accessToken;
        } catch (error) {
            logger.warn("Token refresh failed; the session will end", error);
            return null;
        }
    }

    private expiresSoon(): boolean {
        return this.refreshAt !== undefined && (this.opts.now ?? Date.now)() >= this.refreshAt;
    }

    /** The `fetch` to give the SDK (`fetchFn`). */
    public readonly fetch: typeof fetch = async (input, init) => {
        const baseFetch = this.opts.baseFetch ?? globalThis.fetch.bind(globalThis);
        let sent = bearerOf(input, init);

        if (sent !== undefined && this.expiresSoon()) {
            const fresh = await this.refreshFrom(sent);
            if (fresh && fresh !== sent) {
                init = withBearer(input, init, fresh);
                sent = fresh;
            }
        }

        const response = await baseFetch(input, init);
        if (response.status !== 401 || sent === undefined) return response;

        let errcode: unknown;
        try {
            errcode = ((await response.clone().json()) as { errcode?: unknown })?.errcode;
        } catch {
            return response;
        }
        if (errcode !== "M_UNKNOWN_TOKEN") return response;

        const fresh = await this.refreshFrom(sent);
        if (!fresh || fresh === sent) return response;
        return baseFetch(input, withBearer(input, init, fresh));
    };
}

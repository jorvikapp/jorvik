/**
 * The server the sign-in screen uses when someone picks one in its Server settings, instead of
 * the one in config.json. It stays on this device until they change it.
 */
export interface LoginServer {
    // Where the client API lives, e.g. https://matrix-client.matrix.org.
    baseUrl: string;
    // What they typed and see, e.g. matrix.org.
    serverName: string;
}

export class LoginServerError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "LoginServerError";
    }
}

const LOGIN_SERVER_KEY = "jorvik_login_server";
const CHECK_TIMEOUT_MS = 8000;

export function readLoginServer(): LoginServer | null {
    try {
        const raw = window.localStorage.getItem(LOGIN_SERVER_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<LoginServer>) : null;
        if (parsed && typeof parsed.baseUrl === "string" && typeof parsed.serverName === "string") {
            return { baseUrl: parsed.baseUrl, serverName: parsed.serverName };
        }
    } catch {
        // Unreadable: the default server it is.
    }
    return null;
}

export function saveLoginServer(server: LoginServer): void {
    try {
        window.localStorage.setItem(LOGIN_SERVER_KEY, JSON.stringify(server));
    } catch {
        // Private browsing can refuse storage; the choice then lasts until the page closes.
    }
}

export function clearLoginServer(): void {
    try {
        window.localStorage.removeItem(LOGIN_SERVER_KEY);
    } catch {
        // Nothing stored.
    }
}

async function checkMatrixServer(baseUrl: string, serverName: string, fetchImpl: typeof fetch): Promise<void> {
    let response: Response;
    try {
        response = await fetchImpl(`${baseUrl}/_matrix/client/versions`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    } catch {
        throw new LoginServerError(`Couldn't reach ${serverName}. Check the name and your connection.`);
    }
    const body = response.ok ? ((await response.json().catch(() => null)) as { versions?: unknown } | null) : null;
    if (!body || !Array.isArray(body.versions)) {
        throw new LoginServerError(`${serverName} doesn't answer like a Matrix server.`);
    }
}

/**
 * Turns what someone typed into a server to sign in to. A name like matrix.org is looked up the
 * way Matrix apps do it, through its /.well-known/matrix/client; an address typed in full
 * (https://...) is used as it is. Either way the server has to answer like a Matrix server.
 */
export async function resolveLoginServer(input: string, fetchImpl: typeof fetch = fetch): Promise<LoginServer> {
    const trimmed = input.trim().replace(/\/+$/, "");
    if (!trimmed) {
        throw new LoginServerError("Enter a server, like matrix.org.");
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        let url: URL;
        try {
            url = new URL(trimmed);
        } catch {
            throw new LoginServerError("That address isn't valid.");
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            throw new LoginServerError("Use an https:// address.");
        }
        const baseUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
        await checkMatrixServer(baseUrl, url.host, fetchImpl);
        return { baseUrl, serverName: url.host };
    }

    const serverName = trimmed.toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/.test(serverName)) {
        throw new LoginServerError("That isn't a server name. Try something like matrix.org.");
    }
    let baseUrl = `https://${serverName}`;
    try {
        const response = await fetchImpl(`https://${serverName}/.well-known/matrix/client`, {
            signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        if (response.ok) {
            const wellKnown = (await response.json()) as { "m.homeserver"?: { base_url?: unknown } };
            const discovered = wellKnown["m.homeserver"]?.base_url;
            if (typeof discovered === "string" && /^https?:\/\//i.test(discovered)) {
                baseUrl = discovered.replace(/\/+$/, "");
            }
        }
    } catch {
        // No .well-known: the name itself may be the server.
    }
    await checkMatrixServer(baseUrl, serverName, fetchImpl);
    return { baseUrl, serverName };
}

/** The host of a server address, for showing it: https://matrix.jorvik.app -> matrix.jorvik.app. */
export function serverLabel(baseUrl: string): string {
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
}

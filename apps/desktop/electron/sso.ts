import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Single sign-on in the desktop app. The provider's sign-in page opens in the person's own browser
 * (where their password manager and passkeys are, and which every provider allows), and the homeserver
 * sends the browser back to a one-time address on this computer, 127.0.0.1 on a free port, with a login
 * token. Only that address with its random state is taken, once, and then it closes. This works the same
 * in every package (Flatpak, Snap, AppImage, deb, rpm, Windows, macOS) without registering a link type
 * with the system.
 */

export type SsoResult = { loginToken: string } | { cancelled: true } | { timedOut: true };

const CALLBACK_PATH = "/jorvik";
/** Time to sign in, including looking up a forgotten password. */
const WAIT_LIMIT_MS = 15 * 60_000;
const MAX_TOKEN_LENGTH = 2048;

interface Listening {
    server: http.Server;
    state: string;
    settle: (result: SsoResult) => void;
    timer: NodeJS.Timeout;
}

let listening: Listening | null = null;
/** The newest sign-in's outcome; kept after it arrives, for a wait that starts late. */
let latest: Promise<SsoResult> | null = null;

function page(title: string, text: string): string {
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        `<title>${title}</title><style>` +
        ":root{color-scheme:light dark}" +
        'body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f5f7;color:#1d1f23}' +
        "@media (prefers-color-scheme:dark){body{background:#17191c;color:#e8e9eb}}" +
        "main{max-width:26rem;padding:24px;text-align:center}h1{font-size:1.3rem;margin:0 0 8px}p{margin:0;opacity:.8;line-height:1.45}" +
        `</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`
    );
}

function respond(response: http.ServerResponse, status: number, title: string, text: string): void {
    response.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        Connection: "close",
    });
    response.end(page(title, text));
}

function sameSecret(given: string, expected: string): boolean {
    const left = Buffer.from(given);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

function finish(current: Listening, result: SsoResult): void {
    if (listening !== current) {
        return;
    }
    listening = null;
    clearTimeout(current.timer);
    current.server.close();
    current.server.closeIdleConnections();
    current.settle(result);
}

/**
 * Starts listening on a fresh one-time address, replacing any earlier one, and returns it for the
 * homeserver to send the browser back to. `onArrived` runs when the token is in.
 */
export async function beginSso(onArrived: () => void): Promise<string> {
    cancelSso();

    const state = randomBytes(16).toString("hex");
    let settle: (result: SsoResult) => void = () => undefined;
    const result = new Promise<SsoResult>((resolve) => {
        settle = resolve;
    });
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const { port } = server.address() as AddressInfo;
    const host = `127.0.0.1:${port}`;

    const current: Listening = {
        server,
        state,
        settle,
        timer: setTimeout(() => finish(current, { timedOut: true }), WAIT_LIMIT_MS),
    };
    listening = current;
    latest = result;

    server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", `http://${host}`);
        // Only as the browser was sent here: a web page can't reach this under a name of its own.
        if (request.method !== "GET" || request.headers.host !== host || url.pathname !== CALLBACK_PATH) {
            respond(response, 404, "Nothing here", "This address is only for signing in to Jorvik.");
            return;
        }
        if (listening !== current || !sameSecret(url.searchParams.get("state") ?? "", state)) {
            respond(response, 400, "This sign-in isn't for Jorvik", "Start signing in again from Jorvik.");
            return;
        }
        const loginToken = url.searchParams.get("loginToken") ?? "";
        if (!loginToken || loginToken.length > MAX_TOKEN_LENGTH) {
            respond(response, 400, "Signing in didn't finish", "Your server didn't send a sign-in token. Go back to Jorvik and try again.");
            return;
        }

        respond(response, 200, "You're signed in", "You can close this tab and go back to Jorvik.");
        finish(current, { loginToken });
        onArrived();
    });

    return `http://${host}${CALLBACK_PATH}?state=${state}`;
}

/** Resolves when the browser comes back to the address beginSso gave out, or the wait ends. */
export function waitForSso(): Promise<SsoResult> {
    return latest ?? Promise.resolve({ cancelled: true });
}

export function cancelSso(): void {
    if (listening) {
        finish(listening, { cancelled: true });
    }
}

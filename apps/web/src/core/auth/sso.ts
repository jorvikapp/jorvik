import { createClient, SSOAction } from "matrix-js-sdk/src/matrix";

/**
 * Single sign-on: the homeserver sends people to the sign-in page of their provider (their company's
 * Keycloak, GitHub, ...), which sends them back with a one-time login token that Jorvik trades for a
 * session.
 *
 * In a browser the whole page goes there and back. Jorvik remembers which server it sent you to and puts
 * a random marker on the address you come back to, and only takes a token that returns with that marker:
 * a link carrying someone else's token can't sign you in to their account. The desktop app gets the
 * token from the browser on a one-time local address instead (see the desktop's sso.ts).
 */

export interface SsoProvider {
    /** The server's id for the provider; absent when the server names none. */
    id?: string;
    /** As the server names it, e.g. "Keycloak". */
    name: string;
    /** "cas" only for a server that offers CAS without m.login.sso. */
    loginType: "sso" | "cas";
}

/** How a server lets people sign in. */
export interface LoginOptions {
    password: boolean;
    sso: SsoProvider[];
}

export { SSOAction };

/** Which server single sign-on was started with, and the marker it should come back with. */
export const SSO_PENDING_STORAGE_KEY = "jorvik_sso_pending";
/** The marker on the address the homeserver sends people back to. */
export const SSO_MARKER_PARAM = "jorvik_sso";
const TOKEN_PARAM = "loginToken";
/** Long enough for a slow trip through a sign-in page; the token itself only lasts minutes. */
const PENDING_MAX_AGE_MS = 30 * 60_000;

interface PendingSso {
    marker: string;
    homeserverUrl: string;
    startedAt: number;
}

/** The providers in a server's login flows (GET /login), one per button. */
export function ssoProvidersFromFlows(flows: ReadonlyArray<{ type?: unknown; identity_providers?: unknown }>): SsoProvider[] {
    const ssoFlow = flows.find((flow) => flow.type === "m.login.sso");
    if (ssoFlow) {
        const listed = (Array.isArray(ssoFlow.identity_providers) ? ssoFlow.identity_providers : [])
            .filter(
                (provider): provider is { id: string; name: string } =>
                    typeof provider?.id === "string" && provider.id.length > 0 && typeof provider.name === "string",
            )
            .map((provider): SsoProvider => ({ id: provider.id, name: provider.name.trim() || provider.id, loginType: "sso" }));
        return listed.length > 0 ? listed : [{ name: "", loginType: "sso" }];
    }
    return flows.some((flow) => flow.type === "m.login.cas") ? [{ name: "", loginType: "cas" }] : [];
}

export async function discoverLoginOptions(homeserverUrl: string): Promise<LoginOptions> {
    const flows = (await createClient({ baseUrl: homeserverUrl }).loginFlows()).flows ?? [];
    return {
        password: flows.some((flow) => flow.type === "m.login.password"),
        sso: ssoProvidersFromFlows(flows),
    };
}

/** What a button for the provider says. */
export function ssoButtonLabel(provider: SsoProvider): string {
    return provider.name ? `Continue with ${provider.name}` : "Continue with single sign-on";
}

/** The homeserver's address that starts signing in with the provider and comes back to `redirectUrl`. */
export function ssoLoginUrl(homeserverUrl: string, redirectUrl: string, provider: SsoProvider, action: SSOAction): string {
    return createClient({ baseUrl: homeserverUrl }).getSsoLoginUrl(redirectUrl, provider.loginType, provider.id, action);
}

function randomMarker(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Leaves the page for the provider's sign-in; Jorvik picks up where it left off when it comes back. */
export function startSsoRedirect(
    homeserverUrl: string,
    provider: SsoProvider,
    action: SSOAction,
    location: Pick<Location, "href" | "assign"> = window.location,
): void {
    const marker = randomMarker();
    const pending: PendingSso = { marker, homeserverUrl, startedAt: Date.now() };
    window.localStorage.setItem(SSO_PENDING_STORAGE_KEY, JSON.stringify(pending));

    const back = new URL(location.href);
    back.search = "";
    back.hash = "";
    back.searchParams.set(SSO_MARKER_PARAM, marker);
    location.assign(ssoLoginUrl(homeserverUrl, back.toString(), provider, action));
}

export type SsoReturn = { homeserverUrl: string; loginToken: string } | { error: string };

function readPending(): PendingSso | null {
    try {
        const raw = window.localStorage.getItem(SSO_PENDING_STORAGE_KEY);
        window.localStorage.removeItem(SSO_PENDING_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<PendingSso>) : null;
        if (
            parsed &&
            typeof parsed.marker === "string" &&
            typeof parsed.homeserverUrl === "string" &&
            typeof parsed.startedAt === "number"
        ) {
            return { marker: parsed.marker, homeserverUrl: parsed.homeserverUrl, startedAt: parsed.startedAt };
        }
    } catch {
        // Unreadable storage: nothing was started here.
    }
    return null;
}

let captured: { value: SsoReturn | null } | null = null;

/**
 * Reads a login token the homeserver sent back and takes it out of the address bar, once per page load.
 * Called as early as possible, so the token doesn't sit in the address bar while Jorvik starts.
 */
export function captureSsoReturn(
    location: Pick<Location, "href"> = window.location,
    history: Pick<History, "replaceState" | "state"> = window.history,
    now = Date.now(),
): void {
    if (captured) {
        return;
    }
    captured = { value: null };

    const url = new URL(location.href);
    const loginToken = url.searchParams.get(TOKEN_PARAM);
    const marker = url.searchParams.get(SSO_MARKER_PARAM);
    if (loginToken === null && marker === null) {
        return;
    }

    url.searchParams.delete(TOKEN_PARAM);
    url.searchParams.delete(SSO_MARKER_PARAM);
    history.replaceState(history.state, "", url.toString());

    const pending = readPending();
    if (!pending || marker === null || pending.marker !== marker || now - pending.startedAt > PENDING_MAX_AGE_MS) {
        captured.value = {
            error: "That sign-in link didn't start in this browser, so Jorvik didn't use it. Sign in again here.",
        };
        return;
    }
    if (!loginToken) {
        captured.value = { error: "Single sign-on didn't finish. Try again." };
        return;
    }
    captured.value = { homeserverUrl: pending.homeserverUrl, loginToken };
}

/** The way back from single sign-on, if this page load is one; only the first caller gets it. */
export function consumeSsoReturn(): SsoReturn | null {
    captureSsoReturn();
    const value = captured?.value ?? null;
    if (captured) {
        captured.value = null;
    }
    return value;
}

export type DesktopSsoResult = { loginToken: string } | { cancelled: true } | { timedOut: true };

/** The desktop app's side of single sign-on (since 1.0.29). */
export interface DesktopSsoBridge {
    /** Starts listening on a one-time local address and returns it, for the homeserver to send the browser back to. */
    ssoBegin: () => Promise<string>;
    /** Resolves when the browser comes back to that address, or the wait is cancelled or runs out. */
    ssoWait: () => Promise<DesktopSsoResult>;
    ssoCancel: () => Promise<void>;
    openExternal: (url: string) => Promise<void>;
}

/**
 * Desktop: opens the provider's sign-in page in the browser and resolves to the login token it sends back,
 * or null when cancelled. `onOpened` gets the page's address, to open it again.
 */
export async function signInWithSsoOnDesktop(
    bridge: DesktopSsoBridge,
    homeserverUrl: string,
    provider: SsoProvider,
    action: SSOAction,
    onOpened: (url: string) => void,
): Promise<string | null> {
    const redirectUrl = await bridge.ssoBegin();
    const url = ssoLoginUrl(homeserverUrl, redirectUrl, provider, action);
    onOpened(url);
    await bridge.openExternal(url);
    const result = await bridge.ssoWait();
    if ("loginToken" in result) {
        return result.loginToken;
    }
    if ("timedOut" in result) {
        throw new Error("Signing in took too long. Try again.");
    }
    return null;
}

/** For tests: forget what this page load captured. */
export function resetSsoReturnForTests(): void {
    captured = null;
}

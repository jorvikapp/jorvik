import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { SdkConfig } from "../config/SdkConfig";
import { forgetRelayCredentials, relayAuthHeaders } from "../voice/relayAuth";

/**
 * Turning on two-factor sign-in from Settings. The server's request service only learns who is asking, from the same
 * OpenID token the voice service takes (it can tell the service the user's ID and nothing else); the server then
 * emails the setup link to the address on the account, which is what proves it's really them.
 */

/** Where this server takes "email me a setup link" requests. Only servers that offer it set it. */
export function twoFactorRequestUrl(): string | null {
    const value = SdkConfig.get("two_factor_request_url");
    return typeof value === "string" && /^https?:\/\//.test(value.trim()) ? value.trim().replace(/\/+$/, "") : null;
}

export interface SetupStatus {
    /** none: nothing asked lately; queued: the server hasn't got to it yet; email_sent; off (turned off); failed (see reason). */
    state: "none" | "queued" | "email_sent" | "off" | "failed";
    /** The address it went to, partly hidden by the server. */
    email?: string;
    /** Why it failed: no_email, name_taken, already_on, deactivated, error, ... */
    reason?: string;
}

const STATES = new Set<SetupStatus["state"]>(["none", "queued", "email_sent", "off", "failed"]);

/** The server's answer, or "none" for anything that isn't one. */
export function parseSetupStatus(body: unknown): SetupStatus {
    const value = (body ?? {}) as Record<string, unknown>;
    const state = STATES.has(value.state as SetupStatus["state"]) ? (value.state as SetupStatus["state"]) : "none";
    const status: SetupStatus = { state };
    if (typeof value.email === "string" && value.email.length <= 320) {
        status.email = value.email;
    }
    if (typeof value.reason === "string" && /^[a-z_]{1,40}$/.test(value.reason)) {
        status.reason = value.reason;
    }
    return status;
}

async function ask(client: MatrixClient, url: string, method: "GET" | "POST"): Promise<SetupStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(url, { method, headers: await relayAuthHeaders(client), cache: "no-store" });
        if (response.status === 401 && attempt === 0) {
            forgetRelayCredentials(client);
            continue;
        }
        if (!response.ok) {
            throw new Error(`Two-factor setup request failed (${response.status})`);
        }
        return parseSetupStatus(await response.json().catch(() => null));
    }
    throw new Error("Two-factor setup request wasn't accepted");
}

/** Ask the server to email this person a setup link. */
export function requestTwoFactorSetup(client: MatrixClient, base: string): Promise<SetupStatus> {
    return ask(client, `${base}/request`, "POST");
}

/** How this person's latest request went. */
export function twoFactorSetupStatus(client: MatrixClient, base: string): Promise<SetupStatus> {
    return ask(client, `${base}/status`, "GET");
}

/**
 * Tell the server it's been turned off: the person has just set a Matrix password, which Synapse only allows after
 * they confirm with their Jorvik account and a code. The server checks that, then unlinks the Jorvik account and puts
 * their email back on the Matrix account.
 */
export function requestTwoFactorOff(client: MatrixClient, base: string): Promise<SetupStatus> {
    return ask(client, `${base}/off`, "POST");
}

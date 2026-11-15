import React, { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { probeReauthWays, type ReauthWay } from "../../../../core/auth/reauth";
import { requestTwoFactorSetup, twoFactorRequestUrl, twoFactorSetupStatus, type SetupStatus } from "../../../../core/auth/twoFactorSetup";
import { SdkConfig } from "../../../../core/config/SdkConfig";

export type TwoFactorState = "checking" | "on" | "off" | "unknown";

/** Turning it on from here: the button, confirming where the link goes, sending, "check your email", or why not. */
export type SetupStep =
    | { step: "idle" }
    | { step: "confirm"; email: string }
    | { step: "sending"; slow: boolean }
    | { step: "sent"; email: string | null }
    | { step: "failed"; reason: string };

/** How often the card asks how sending went, and how many times before it says it's slow. */
const SEND_POLL_MS = 3000;
const SEND_POLLS_BEFORE_SLOW = 15;
/** After the email went out, how often it looks whether the server has switched it on. */
const ON_POLL_MS = 15000;

/** The page where people manage their codes and passkeys. Only servers that offer two-factor sign-in set it. */
export function accountManagementUrl(): string | null {
    const value = SdkConfig.get("account_management_url");
    return typeof value === "string" && /^https?:\/\//.test(value.trim()) ? value.trim() : null;
}

/**
 * On when the account can only confirm it's you through its Jorvik account (no password left on the Matrix side),
 * off while it still has a password. Anything else can't be told from here.
 */
export function twoFactorStateFromWays(ways: ReauthWay[] | null): TwoFactorState {
    if (!ways) {
        return "unknown";
    }
    if (ways.some((way) => way.kind === "password")) {
        return "off";
    }
    return ways.some((way) => way.kind === "sso") ? "on" : "unknown";
}

/** What to tell someone when the server couldn't send their setup link. */
export function setupFailureText(reason: string | undefined): string {
    switch (reason) {
        case "no_email":
            return "Setup needs an email address on your account, and yours has none. Ask a server admin to add one.";
        case "name_taken":
            return "Your name is already used by another account in the sign-in service, so this can't be done from here. Ask a server admin to turn it on for you.";
        case "deactivated":
        case "no_such_user":
        case "bad_request":
            return "This account can't turn on two-factor sign-in from here. Ask a server admin.";
        default:
            return "Something went wrong sending your setup link. Try again in a while, or ask a server admin.";
    }
}

/** The step a server answer means, or null when nothing has been asked for lately. */
export function setupFromStatus(status: SetupStatus, knownEmail: string | null): SetupStep | null {
    switch (status.state) {
        case "queued":
            return { step: "sending", slow: false };
        case "email_sent":
            return { step: "sent", email: knownEmail ?? status.email ?? null };
        case "failed":
            // Already on: the card shows On as soon as it looks again, so there's nothing to explain.
            return status.reason === "already_on" ? null : { step: "failed", reason: status.reason ?? "error" };
        default:
            return null;
    }
}

/** Settings > My Account: whether this account signs in with two factors, turning it on, and managing it. */
export function TwoFactorSection({ client }: { client: MatrixClient }): React.ReactElement | null {
    const url = accountManagementUrl();
    const requestUrl = twoFactorRequestUrl();
    const [state, setState] = useState<TwoFactorState>("checking");
    const [setup, setSetup] = useState<SetupStep>({ step: "idle" });
    const alive = useRef(true);
    const email = useRef<string | null>(null);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const look = useCallback(async () => {
        const next = twoFactorStateFromWays(await probeReauthWays(client));
        if (alive.current) {
            setState(next);
        }
    }, [client]);

    useEffect(() => {
        if (url) {
            void look();
        }
    }, [url, look]);

    // Off, and this server lets people turn it on here: pick up a request made earlier (another visit, another device).
    useEffect(() => {
        if (state !== "off" || !requestUrl) {
            return undefined;
        }
        let cancelled = false;
        twoFactorSetupStatus(client, requestUrl).then(
            (status) => {
                const next = setupFromStatus(status, email.current);
                if (!cancelled && next) {
                    setSetup(next);
                }
            },
            () => undefined,
        );
        return () => {
            cancelled = true;
        };
    }, [client, requestUrl, state]);

    // Sending: the server answers within seconds; ask every few seconds, and say so if it's taking long.
    const sending = setup.step === "sending";
    useEffect(() => {
        if (!sending || !requestUrl) {
            return undefined;
        }
        let polls = 0;
        const timer = window.setInterval(() => {
            polls += 1;
            twoFactorSetupStatus(client, requestUrl).then(
                (status) => {
                    const next = setupFromStatus(status, email.current);
                    if (!alive.current) {
                        return;
                    }
                    if (next && next.step !== "sending") {
                        setSetup(next);
                    } else if (polls === SEND_POLLS_BEFORE_SLOW) {
                        setSetup({ step: "sending", slow: true });
                    }
                },
                () => undefined,
            );
        }, SEND_POLL_MS);
        return () => window.clearInterval(timer);
    }, [client, requestUrl, sending]);

    // Sent: once they've finished in the browser the server switches it on within a minute. Look again now and then,
    // and whenever they come back to this window.
    const waiting = setup.step === "sent" && state === "off";
    useEffect(() => {
        if (!waiting) {
            return undefined;
        }
        const again = (): void => {
            void look();
        };
        const timer = window.setInterval(again, ON_POLL_MS);
        window.addEventListener("focus", again);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", again);
        };
    }, [waiting, look]);

    const startTurnOn = async (): Promise<void> => {
        let address: string | null = null;
        try {
            const { threepids } = await client.getThreePids();
            address = threepids.find((threepid) => threepid.medium === "email")?.address ?? null;
        } catch {
            if (alive.current) {
                setSetup({ step: "failed", reason: "error" });
            }
            return;
        }
        if (!alive.current) {
            return;
        }
        email.current = address;
        setSetup(address ? { step: "confirm", email: address } : { step: "failed", reason: "no_email" });
    };

    const send = async (): Promise<void> => {
        if (!requestUrl) {
            return;
        }
        setSetup({ step: "sending", slow: false });
        try {
            await requestTwoFactorSetup(client, requestUrl);
        } catch {
            if (alive.current) {
                setSetup({ step: "failed", reason: "error" });
            }
        }
    };

    if (!url || state === "unknown") {
        return null;
    }

    return (
        <section className="settings-section-card settings-two-factor" aria-busy={state === "checking"}>
            <h3 className="settings-two-factor-title">
                Two-factor sign-in
                {state !== "checking" ? (
                    <span className={`settings-role-badge settings-role-${state === "on" ? "verified" : "unverified"}`}>
                        {state === "on" ? "On" : "Off"}
                    </span>
                ) : null}
            </h3>
            {state === "checking" ? <p className="settings-inline-note">Checking...</p> : null}
            {state === "on" ? (
                <>
                    <p className="settings-inline-note">
                        You sign in with your Jorvik account: your password, then a code from your authenticator app or a
                        passkey. Your password alone can't get anyone into your account.
                    </p>
                    <div className="settings-actions-row">
                        <a className="settings-button settings-button-secondary" href={url} target="_blank" rel="noopener noreferrer">
                            Manage codes and passkeys
                        </a>
                    </div>
                    <p className="settings-inline-note">To turn it off, ask a server admin.</p>
                </>
            ) : null}
            {state === "off" && !requestUrl ? (
                <p className="settings-inline-note">
                    Your account signs in with just a password. Ask a server admin to turn on two-factor sign-in: you'll then
                    also need a code from an authenticator app or a passkey, so a password alone can't get anyone in.
                </p>
            ) : null}
            {state === "off" && requestUrl && setup.step === "idle" ? (
                <>
                    <p className="settings-inline-note">
                        Your account signs in with just a password. Turn on two-factor sign-in and you'll also need a code
                        from an authenticator app or a passkey, so a password alone can't get anyone in.
                    </p>
                    <div className="settings-actions-row">
                        <button type="button" className="settings-button" onClick={() => void startTurnOn()}>
                            Turn on
                        </button>
                    </div>
                </>
            ) : null}
            {state === "off" && requestUrl && setup.step === "confirm" ? (
                <>
                    <p className="settings-inline-note">
                        We'll email a setup link to <strong>{setup.email}</strong>. From it you set up an authenticator app
                        or a passkey, save your recovery codes and set your password. You can keep the one you use now.
                    </p>
                    <p className="settings-inline-note">
                        After that you sign in with “Continue with Jorvik account” and a code. You stay signed in where you
                        are now.
                    </p>
                    <div className="settings-actions-row">
                        <button type="button" className="settings-button" onClick={() => void send()}>
                            Send setup email
                        </button>
                        <button type="button" className="settings-button settings-button-secondary" onClick={() => setSetup({ step: "idle" })}>
                            Cancel
                        </button>
                    </div>
                </>
            ) : null}
            {state === "off" && requestUrl && setup.step === "sending" ? (
                <p className="settings-inline-note" role="status">
                    {setup.slow
                        ? "Still waiting for the server. Check your email in a few minutes, or try again later."
                        : "Sending your setup link..."}
                </p>
            ) : null}
            {state === "off" && requestUrl && setup.step === "sent" ? (
                <>
                    <p className="settings-inline-note" role="status">
                        Check your email: we sent a setup link to <strong>{setup.email ?? "your email address"}</strong>. It
                        works for 48 hours. Once you've finished, this shows On.
                    </p>
                    <div className="settings-actions-row">
                        <button type="button" className="settings-button settings-button-secondary" onClick={() => void send()}>
                            Send it again
                        </button>
                    </div>
                </>
            ) : null}
            {state === "off" && requestUrl && setup.step === "failed" ? (
                <>
                    <p className="settings-inline-note" role="alert">
                        {setupFailureText(setup.reason)}
                    </p>
                    {setup.reason === "error" ? (
                        <div className="settings-actions-row">
                            <button type="button" className="settings-button settings-button-secondary" onClick={() => setSetup({ step: "idle" })}>
                                Try again
                            </button>
                        </div>
                    ) : null}
                </>
            ) : null}
        </section>
    );
}

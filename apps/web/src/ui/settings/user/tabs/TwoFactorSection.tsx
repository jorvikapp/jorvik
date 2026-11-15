import React, { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    afterPageAuth,
    probeReauthWays,
    readReauthChallenge,
    type ReauthChallenge,
    type ReauthPageWay,
    type ReauthWay,
} from "../../../../core/auth/reauth";
import {
    requestTwoFactorOff,
    requestTwoFactorSetup,
    twoFactorRequestUrl,
    twoFactorSetupStatus,
    type SetupStatus,
} from "../../../../core/auth/twoFactorSetup";
import { SdkConfig } from "../../../../core/config/SdkConfig";
import { useReauthPage } from "../../../components/auth/useReauthPage";

export type TwoFactorState = "checking" | "on" | "off" | "unknown";

/** Turning it on from here: the button, confirming where the link goes, sending, "check your email", or why not. */
export type SetupStep =
    | { step: "idle" }
    | { step: "confirm"; email: string }
    | { step: "sending"; slow: boolean }
    | { step: "sent"; email: string | null }
    | { step: "failed"; reason: string };

/**
 * Turning it off from here: choosing the password to sign in with, confirming with the Jorvik account (Synapse asks
 * for that before it lets the password be set), then the server unlinks the Jorvik account and puts the email back.
 */
export type OffStep =
    | { step: "idle" }
    | { step: "form"; pending: boolean; challenge: ReauthChallenge | null; error: string | null }
    | { step: "finishing" };

/** How often the card asks how a request went, and how many times before it says it's slow. */
const POLL_MS = 3000;
const POLLS_BEFORE_SLOW = 15;
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

function isPageWay(way: ReauthWay): way is ReauthPageWay {
    return way.kind === "sso" || way.kind === "approve";
}

/** The server's own words when it has some (a password that's too short, say), otherwise a plain sentence. */
function errorText(error: unknown): string {
    const fromServer = (error as { data?: { error?: unknown } } | null)?.data?.error;
    if (typeof fromServer === "string" && fromServer.trim().length > 0) {
        return fromServer;
    }
    return "Something went wrong. Try again in a while.";
}

/** Settings > My Account: whether this account signs in with two factors, turning it on or off, and managing it. */
export function TwoFactorSection({ client }: { client: MatrixClient }): React.ReactElement | null {
    const url = accountManagementUrl();
    const requestUrl = twoFactorRequestUrl();
    const [state, setState] = useState<TwoFactorState>("checking");
    const [setup, setSetup] = useState<SetupStep>({ step: "idle" });
    const [off, setOff] = useState<OffStep>({ step: "idle" });
    const [newPassword, setNewPassword] = useState("");
    const [newPasswordAgain, setNewPasswordAgain] = useState("");
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
                    } else if (polls === POLLS_BEFORE_SLOW) {
                        setSetup({ step: "sending", slow: true });
                    }
                },
                () => undefined,
            );
        }, POLL_MS);
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

    // Turning off: once the password is set the server tidies up within seconds; then the card shows Off.
    const finishingOff = off.step === "finishing";
    useEffect(() => {
        if (!finishingOff || !requestUrl) {
            return undefined;
        }
        let polls = 0;
        const done = (): void => {
            setOff({ step: "idle" });
            setSetup({ step: "idle" });
            void look();
        };
        const timer = window.setInterval(() => {
            polls += 1;
            twoFactorSetupStatus(client, requestUrl).then(
                (status) => {
                    if (alive.current && (status.state === "off" || status.state === "failed" || polls >= POLLS_BEFORE_SLOW)) {
                        done();
                    }
                },
                () => undefined,
            );
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [client, requestUrl, finishingOff, look]);

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

    const offChallenge = off.step === "form" ? off.challenge : null;
    const offPageWay = offChallenge?.ways.find(isPageWay) ?? null;
    // When the server's page says it's done, finish turning it off without another click.
    const offPage = useReauthPage(offPageWay, () => void submitOff());

    const submitOff = async (): Promise<void> => {
        if (off.step !== "form" || !requestUrl || off.pending) {
            return;
        }
        if (newPassword.length === 0) {
            setOff({ ...off, error: "Choose the password you'll sign in with." });
            return;
        }
        if (newPassword !== newPasswordAgain) {
            setOff({ ...off, error: "The two passwords don't match." });
            return;
        }
        const asked = off.challenge;
        setOff({ ...off, pending: true, error: null });
        try {
            const pageWay = asked?.ways.find(isPageWay) ?? null;
            const auth = asked && pageWay && offPage.opened ? afterPageAuth(pageWay, asked.session) : null;
            if (asked && !auth) {
                throw new Error("unconfirmed");
            }
            await client.setPassword((auth ?? undefined) as never, newPassword, false);
        } catch (error) {
            if (!alive.current) {
                return;
            }
            const challenge = readReauthChallenge(client, error);
            if (challenge && !asked) {
                const canDo = challenge.ways.some(isPageWay);
                setOff({ step: "form", pending: false, challenge, error: canDo ? null : "Your server asks for a check Jorvik can't do here." });
                return;
            }
            const message =
                challenge || (error instanceof Error && error.message === "unconfirmed")
                    ? "Confirm it's you with your Jorvik account first, then try again."
                    : errorText(error);
            setOff({ step: "form", pending: false, challenge: asked, error: message });
            return;
        }
        // The password works on its own from now on. The server unlinks the Jorvik account and puts the email back.
        setNewPassword("");
        setNewPasswordAgain("");
        setOff({ step: "finishing" });
        requestTwoFactorOff(client, requestUrl).catch(() => undefined);
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
            {state === "on" && off.step === "idle" ? (
                <>
                    <p className="settings-inline-note">
                        You sign in with your Jorvik account: your password, then a code from your authenticator app or a
                        passkey. Your password alone can't get anyone into your account.
                    </p>
                    <div className="settings-actions-row">
                        <a className="settings-button settings-button-secondary" href={url} target="_blank" rel="noopener noreferrer">
                            Manage codes and passkeys
                        </a>
                        {requestUrl ? (
                            <button
                                type="button"
                                className="settings-button settings-button-secondary"
                                onClick={() => setOff({ step: "form", pending: false, challenge: null, error: null })}
                            >
                                Turn off
                            </button>
                        ) : null}
                    </div>
                    {requestUrl ? null : <p className="settings-inline-note">To turn it off, ask a server admin.</p>}
                </>
            ) : null}
            {state === "on" && off.step === "form" ? (
                <form
                    className="settings-two-factor-off"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submitOff();
                    }}
                >
                    <p className="settings-inline-note">
                        Turning it off means your password alone signs you in again, without a code. Choose the password
                        you'll sign in with. It can be the one you use for your Jorvik account.
                    </p>
                    <label className="settings-field">
                        Password
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                            disabled={off.pending || offChallenge !== null}
                            autoFocus
                        />
                    </label>
                    <label className="settings-field">
                        Password again
                        <input
                            type="password"
                            value={newPasswordAgain}
                            onChange={(event) => setNewPasswordAgain(event.target.value)}
                            autoComplete="new-password"
                            disabled={off.pending || offChallenge !== null}
                        />
                    </label>
                    {offPageWay ? (
                        <div className="settings-reauth-page">
                            <p className="settings-inline-note">
                                {offPageWay.kind === "sso"
                                    ? "Confirm it's you with your Jorvik account: your password, then a code."
                                    : "Your server wants this approved on its account page first."}
                                {offPage.opened ? " Once that's done, it turns off here." : ""}
                            </p>
                            <div className="settings-actions-row">
                                <button type="button" className="settings-button settings-button-secondary" onClick={offPage.open}>
                                    {offPageWay.kind === "sso" ? "Continue with Jorvik account" : "Open the account page"}
                                </button>
                            </div>
                        </div>
                    ) : null}
                    {off.error ? <p className="settings-inline-error">{off.error}</p> : null}
                    <div className="settings-actions-row">
                        <button
                            type="submit"
                            className="settings-button settings-button-danger"
                            disabled={off.pending || (offChallenge !== null && !offPage.opened)}
                        >
                            {off.pending ? "Turning off..." : "Turn off"}
                        </button>
                        <button
                            type="button"
                            className="settings-button settings-button-secondary"
                            onClick={() => {
                                setNewPassword("");
                                setNewPasswordAgain("");
                                setOff({ step: "idle" });
                            }}
                            disabled={off.pending}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            ) : null}
            {off.step === "finishing" ? (
                <p className="settings-inline-note" role="status">
                    Turning it off...
                </p>
            ) : null}
            {state === "off" && off.step === "idle" && !requestUrl ? (
                <p className="settings-inline-note">
                    Your account signs in with just a password. Ask a server admin to turn on two-factor sign-in: you'll then
                    also need a code from an authenticator app or a passkey, so a password alone can't get anyone in.
                </p>
            ) : null}
            {state === "off" && off.step === "idle" && requestUrl && setup.step === "idle" ? (
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
            {state === "off" && off.step === "idle" && requestUrl && setup.step === "confirm" ? (
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
            {state === "off" && off.step === "idle" && requestUrl && setup.step === "sending" ? (
                <p className="settings-inline-note" role="status">
                    {setup.slow
                        ? "Still waiting for the server. Check your email in a few minutes, or try again later."
                        : "Sending your setup link..."}
                </p>
            ) : null}
            {state === "off" && off.step === "idle" && requestUrl && setup.step === "sent" ? (
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
            {state === "off" && off.step === "idle" && requestUrl && setup.step === "failed" ? (
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

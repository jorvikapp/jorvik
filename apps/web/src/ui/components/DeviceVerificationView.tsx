import React, { useCallback, useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { probeReauthWays, type ReauthPageWay, type ReauthWay } from "../../core/auth/reauth";
import { isRecoveryKeyValid, type ResetIdentityAuth } from "../adapters/securityRecoveryAdapter";
import { useReauthPage } from "./auth/useReauthPage";
import { useIncomingSelfVerification } from "./verification/IncomingVerificationDialog";
import { type IncomingVerificationRequest, VerificationDialog } from "./verification/VerificationDialog";

interface DeviceVerificationViewProps {
    client: MatrixClient;
    error: string | null;
    localDeviceVerified: boolean;
    canSkip: boolean;
    onRefreshStatus: () => Promise<void>;
    onSkip: () => Promise<void>;
    onResetIdentity: (auth: ResetIdentityAuth, securityKey: string) => Promise<void>;
    onLogout: () => Promise<void>;
    /** Which account this is, e.g. "@admin". */
    accountLabel?: string | null;
}

type ActionState = "refresh" | "skip" | "logout" | "reset" | null;

/** Midway through a reset: the server's page to confirm on, and what to do after. */
interface PageStep {
    way: ReauthPageWay;
    done: () => void;
    stop: () => void;
}

export function DeviceVerificationView({
    client,
    error,
    localDeviceVerified,
    canSkip,
    onRefreshStatus,
    onSkip,
    onResetIdentity,
    onLogout,
    accountLabel,
}: DeviceVerificationViewProps): React.ReactElement {
    const [pendingAction, setPendingAction] = useState<ActionState>(null);
    const [verificationOpen, setVerificationOpen] = useState(false);
    const [incomingRequest, setIncomingRequest] = useState<IncomingVerificationRequest | null>(null);
    const [resetOpen, setResetOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [securityKey, setSecurityKey] = useState("");
    const [resetError, setResetError] = useState<string | null>(null);
    // How the server wants the reset confirmed: undefined while asking, null when it can't say.
    const [reauthWays, setReauthWays] = useState<ReauthWay[] | null | undefined>(undefined);
    const [pageStep, setPageStep] = useState<PageStep | null>(null);
    const reauthPage = useReauthPage(pageStep?.way ?? null, () => pageStep?.done());

    useEffect(() => {
        if (!resetOpen) {
            return;
        }
        let cancelled = false;
        setReauthWays(undefined);
        void probeReauthWays(client).then((ways) => {
            if (!cancelled) {
                setReauthWays(ways);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [client, resetOpen]);

    const knowsPassword = reauthWays?.some((way) => way.kind === "password") ?? false;
    // When the server can't say, ask for it without insisting.
    const askPassword = reauthWays === null || knowsPassword;
    const confirmsOnPage = !askPassword && (reauthWays?.some((way) => way.kind !== "password") ?? false);

    const confirmOnPage = useCallback(
        (way: ReauthPageWay) =>
            new Promise<void>((resolve, reject) => {
                setPageStep({
                    way,
                    done: () => {
                        setPageStep(null);
                        resolve();
                    },
                    stop: () => {
                        setPageStep(null);
                        reject(new Error("The reset didn't finish. Start it again to finish it."));
                    },
                });
            }),
        [],
    );

    // Verification can also be started from the other session.
    useIncomingSelfVerification(client, (request) => {
        if (!verificationOpen) {
            setIncomingRequest(request);
            setVerificationOpen(true);
        }
    });

    const runAction = async (action: ActionState, callback: () => Promise<void>): Promise<void> => {
        setPendingAction(action);
        try {
            await callback();
        } finally {
            setPendingAction(null);
        }
    };

    const securityKeyValid = securityKey.trim().length > 0 && isRecoveryKeyValid(securityKey.trim());
    const canReset =
        securityKeyValid && pendingAction === null && reauthWays !== undefined && (!knowsPassword || password.length > 0);

    const handleReset = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!canReset) {
            return;
        }

        setResetError(null);
        await runAction("reset", async () => {
            try {
                await onResetIdentity({ password: askPassword && password.length > 0 ? password : undefined, confirmOnPage }, securityKey);
            } catch (resetFailure) {
                setResetError(resetFailure instanceof Error ? resetFailure.message : String(resetFailure));
            }
        });
    };

    return (
        <div className="login-view">
            <div className="login-card security-card verification-gate-card">
                <div className="verification-gate-banner">
                    <h1>Verify this session</h1>
                    <p>Confirm it's you from another session where you're signed in.</p>
                    {accountLabel ? (
                        <p className="security-signed-in">
                            Signed in as <strong>{accountLabel}</strong>
                        </p>
                    ) : null}
                </div>

                <div className="verification-gate-body">
                    <p className="login-inline-note">
                        Your signing keys are on another session. Start verification here, accept it there (in Jorvik or
                        Element), and check that the emoji match.
                    </p>
                    {localDeviceVerified ? <p className="security-key-valid">This session is verified.</p> : null}
                    {error ? <p className="login-error">{error}</p> : null}
                </div>

                <div className="security-actions verification-gate-actions">
                    <button
                        type="button"
                        onClick={() => {
                            setIncomingRequest(null);
                            setVerificationOpen(true);
                        }}
                        disabled={pendingAction !== null}
                    >
                        Start Verification
                    </button>
                    <button
                        type="button"
                        className="security-skip"
                        onClick={() => void runAction("refresh", onRefreshStatus)}
                        disabled={pendingAction !== null}
                    >
                        {pendingAction === "refresh" ? "Checking..." : "Continue"}
                    </button>
                    {canSkip ? (
                        <button
                            type="button"
                            className="security-skip"
                            onClick={() => void runAction("skip", onSkip)}
                            disabled={pendingAction !== null}
                        >
                            {pendingAction === "skip" ? "Skipping..." : "Skip for now"}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="security-skip"
                        onClick={() => void runAction("logout", onLogout)}
                        disabled={pendingAction !== null}
                    >
                        {pendingAction === "logout" ? "Signing out..." : "Sign out"}
                    </button>
                    {!resetOpen ? (
                        <button type="button" className="login-link-button" onClick={() => setResetOpen(true)}>
                            Can't verify? Reset your identity
                        </button>
                    ) : null}
                </div>

                {resetOpen ? (
                    <form className="verification-gate-reset" onSubmit={(event) => void handleReset(event)}>
                        <h2>Reset your identity</h2>
                        <p className="login-inline-note">
                            Only do this if none of your other sessions has your signing keys, for example because you
                            signed out of all of them. Your messages and security key stay the same, but people who
                            verified you will need to verify you again.
                        </p>
                        {askPassword ? (
                            <label>
                                Account password
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    autoComplete="current-password"
                                />
                            </label>
                        ) : null}
                        {confirmsOnPage ? (
                            <p className="login-inline-note">
                                Your server will ask you to confirm it's you on its own page while the reset runs.
                            </p>
                        ) : null}
                        <label>
                            Security key
                            <input
                                type="password"
                                value={securityKey}
                                onChange={(event) => setSecurityKey(event.target.value)}
                                placeholder="EsTc ..."
                                autoComplete="off"
                            />
                        </label>
                        {securityKey.length > 0 && !securityKeyValid ? (
                            <p className="security-key-invalid">Security key format is invalid.</p>
                        ) : null}
                        {pageStep ? (
                            <div className="verification-gate-reauth" role="status">
                                <p className="login-inline-note">
                                    {pageStep.way.kind === "sso"
                                        ? "To finish the reset, confirm it's you with single sign-on on your server's page."
                                        : "To finish the reset, approve it on your server's account page."}
                                    {reauthPage.opened ? " Then finish the reset here." : ""}
                                </p>
                                <div className="security-actions">
                                    <button type="button" onClick={reauthPage.open}>
                                        {pageStep.way.kind === "sso" ? "Continue with single sign-on" : "Open the account page"}
                                    </button>
                                    <button type="button" className="security-skip" disabled={!reauthPage.opened} onClick={pageStep.done}>
                                        Finish reset
                                    </button>
                                    <button type="button" className="security-skip" onClick={pageStep.stop}>
                                        Stop
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        {resetError ? <p className="login-error">{resetError}</p> : null}
                        <div className="security-actions">
                            <button type="submit" className="security-danger" disabled={!canReset}>
                                {pendingAction === "reset" ? "Resetting..." : "Reset identity"}
                            </button>
                            <button
                                type="button"
                                className="security-skip"
                                onClick={() => {
                                    setResetOpen(false);
                                    setPassword("");
                                    setSecurityKey("");
                                    setResetError(null);
                                }}
                                disabled={pendingAction !== null}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : null}
            </div>
            <VerificationDialog
                client={client}
                open={verificationOpen}
                incomingRequest={incomingRequest}
                onClose={() => {
                    setVerificationOpen(false);
                    setIncomingRequest(null);
                }}
                onCompleted={() => {
                    setVerificationOpen(false);
                    setIncomingRequest(null);
                    void runAction("refresh", onRefreshStatus);
                }}
            />
        </div>
    );
}
